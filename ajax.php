<?php
// local/buscador/ajax.php
declare(strict_types=1);

define('AJAX_SCRIPT', true);
define('NO_DEBUG_DISPLAY', true);
define('NO_OUTPUT_BUFFERING', true);

require('../../config.php');

$action    = optional_param('action', 'courses', PARAM_ALPHANUMEXT);
$courseid  = optional_param('courseid', 0, PARAM_INT);
$cmid      = optional_param('cmid', 0, PARAM_INT);       // para folderfiles (lazy)
$contextid = optional_param('contextid', 0, PARAM_INT);  // robustez extra

$PAGE->set_url(new moodle_url('/local/buscador/ajax.php', [
    'action'    => $action,
    'courseid'  => $courseid,
    'cmid'      => $cmid,
    'contextid' => $contextid,
]));
$PAGE->set_context($courseid > 0 ? context_course::instance($courseid) : context_system::instance());

require_login();
require_sesskey();
require_capability('local/buscador:view', context_system::instance());

@header('Content-Type: application/json; charset=utf-8');
@header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
\core\session\manager::write_close();

/* ======= parámetros comunes ======= */
$q          = trim(optional_param('q', '', PARAM_RAW_TRIMMED));
$page       = max(1, (int)optional_param('page', 1, PARAM_INT));
$limit      = min(200, max(1, (int)optional_param('limit', 24, PARAM_INT)));
$typesraw   = optional_param('types', '', PARAM_RAW_TRIMMED);
$coursesraw = optional_param('courses', '', PARAM_RAW_TRIMMED);

/* ======= helpers ======= */
function lb_parse_types(string $raw): array {
    $out = [];
    foreach (preg_split('/[,\s]+/', core_text::strtolower($raw), -1, PREG_SPLIT_NO_EMPTY) as $t) {
        if (preg_match('/^[a-z0-9_]+$/', $t)) { $out[$t] = true; }
    }
    return array_keys($out);
}
function lb_parse_ids(string $raw): array {
    $out = [];
    foreach (preg_split('/[,\s]+/', $raw, -1, PREG_SPLIT_NO_EMPTY) as $id) {
        $id = (int)$id; if ($id > 0) { $out[$id] = true; }
    }
    return array_values(array_keys($out));
}
function lb_fold(?string $s): string {
    $s = core_text::strtolower($s ?? '');
    if (class_exists('\Transliterator')) {
        $tr = \Transliterator::create('NFD; [:Nonspacing Mark:] Remove; NFC; Any-Latin; Latin-ASCII');
        if ($tr) { $s = $tr->transliterate($s); }
    } else {
        $tmp = @iconv('UTF-8','ASCII//TRANSLIT//IGNORE',$s);
        if ($tmp !== false) { $s = $tmp; }
    }
    return $s;
}
/** comparación con pliegue (acentos/ñ): true si $needlefold está en $haystack */
function lb_match(?string $haystack, string $needlefold): bool {
    return ($needlefold === '' ? true : (strpos(lb_fold($haystack ?? ''), $needlefold) !== false));
}

/**
 * Devuelve un arreglo plano de archivos visibles en el filearea de un mod_folder usando file_storage:
 * - sin duplicados (barre itemid=0, revision y otros itemid existentes),
 * - URL pluginfile en modo inline (sin forcedownload).
 */
function lb_folder_children_fs(\context_module $context): array {
    global $DB, $OUTPUT;

    $out = [];
    try {
        $fs = get_file_storage();

        // Conjuntos de itemid a revisar.
        $itemids = [0];

        $instanceid = (int)$DB->get_field('course_modules', 'instance', ['id' => $context->instanceid], IGNORE_MISSING);
        if ($instanceid) {
            if ($folder = $DB->get_record('folder', ['id' => $instanceid], 'id, revision', IGNORE_MISSING)) {
                $itemids[] = (int)$folder->revision;
            }
        }

        // Cualquier itemid adicional que exista en files.
        $extraids = $DB->get_fieldset_sql(
            "SELECT DISTINCT itemid
               FROM {files}
              WHERE contextid = ?
                AND component = 'mod_folder'
                AND filearea  = 'content'
                AND filename <> '.'",
            [$context->id]
        );
        foreach ($extraids as $iid) {
            $iid = (int)$iid;
            if (!in_array($iid, $itemids, true)) { $itemids[] = $iid; }
        }

        $itemids = array_values(array_unique($itemids));
        $seen = [];

        foreach ($itemids as $iid) {
            $files = $fs->get_area_files($context->id, 'mod_folder', 'content', $iid, 'filepath, filename', false);
            foreach ($files as $f) {
                if ($f->is_directory()) { continue; }

                $relname = ltrim($f->get_filepath(), '/');
                $relname = $relname . $f->get_filename();
                $m       = $f->get_mimetype();
                $iconurl = $OUTPUT->image_url(file_mimetype_icon($m))->out(false);

                // URL pluginfile SIN forcedownload (inline).
                $url = \moodle_url::make_pluginfile_url(
                    $context->id, 'mod_folder', 'content',
                    $iid, $f->get_filepath(), $f->get_filename(), false
                )->out(false);

                $key = $relname . '|' . $url;
                if (isset($seen[$key])) { continue; }
                $seen[$key] = 1;

                $out[] = [
                    'name'    => $relname,
                    'url'     => $url,
                    'icon'    => $iconurl,
                    'modname' => 'file',
                ];
            }
        }
    } catch (\Throwable $e) { /* noop */ }
    return $out;
}
function lb_folder_children_cm(cm_info $cm): array {
    $context = \context_module::instance($cm->id);
    return lb_folder_children_fs($context);
}

/* ======= filtros parseados ======= */
$typesfilter   = lb_parse_types($typesraw);
$coursesfilter = lb_parse_ids($coursesraw);

/* ===== Ocultos por completo ===== */
$HIDE_TYPES = ['qbank'];

try {
    /* ---------- tipos ---------- */
    if ($action === 'types') {
        $aliases = [
            'assign'=>'Tarea','attendance'=>'Asistencia','book'=>'Libro','choice'=>'Elección',
            'data'=>'Base de datos','feedback'=>'Retroalimentación','folder'=>'Carpeta','forum'=>'Foro',
            'glossary'=>'Glosario','h5pactivity'=>'Interactivas','imscp'=>'Paquete IMS','label'=>'Etiqueta',
            'lesson'=>'Lección','lti'=>'LTI','page'=>'Página','quiz'=>'Examen','resource'=>'Documentos',
            'scorm'=>'SCORM','survey'=>'Encuesta','url'=>'Enlace','wiki'=>'Resumen','workshop'=>'Taller',
            'edwiservideoactivity'=>'Videos','imgviewer'=>'Flashcards'
        ];
        $seen = [];
        $enrolled = enrol_get_my_courses(['id','fullname'], 'fullname ASC');
        foreach ($enrolled as $c) {
            $modinfo = get_fast_modinfo($c);
            foreach ($modinfo->get_cms() as $cm) {
                if ($cm->deletioninprogress || !$cm->uservisible) { continue; }
                $seen[$cm->modname] = true;
            }
        }
        if (empty($seen)) {
            $mods = \core_component::get_plugin_list('mod');
            foreach ($mods as $modname => $dir) { $seen[$modname] = true; }
        }
        foreach ($HIDE_TYPES as $bad) { unset($seen[$bad]); }

        $list = [];
        foreach (array_keys($seen) as $modname) {
            try { $label = $aliases[$modname] ?? get_string('modulename', 'mod_'.$modname); }
            catch (\Throwable $e) { $label = ucfirst($modname); }
            $list[] = ['modname'=>$modname, 'label'=>(string)$label];
        }
        usort($list, fn($a,$b)=> strcasecmp($a['label'],$b['label']));
        echo json_encode(['types'=>$list], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE); exit;
    }

    /* ---------- cursos ---------- */
    if ($action === 'courses') {
        $cache = \cache::make('local_buscador', 'courses');
        $ckey  = 'u'.(int)$USER->id;
        $courses = $cache->get($ckey);
        if ($courses === false) {
            $enrolled = enrol_get_my_courses(['id','fullname','shortname','category'], 'fullname ASC');
            $courses = [];
            foreach ($enrolled as $c) {
                $catname = '';
                if ($c->category) {
                    try { $cat = \core_course_category::get($c->category, IGNORE_MISSING, true);
                          $catname = $cat ? $cat->get_formatted_name() : ''; }
                    catch (\Throwable $e) { $catname = ''; }
                }
                $courses[] = [
                    'courseid'  => (int)$c->id,
                    'coursename'=> format_string($c->fullname, true),
                    'category'  => format_string($catname, true),
                    'shortname' => format_string($c->shortname ?? '', true),
                    'url'       => (new moodle_url('/course/view.php',['id'=>$c->id]))->out(false),
                ];
            }
            $cache->set($ckey, $courses);
        }

        $qf = lb_fold($q);
        if ($qf !== '') {
            $courses = array_values(array_filter($courses, function($c) use($qf){
                return (strpos(lb_fold($c['coursename']), $qf) !== false)
                    || (strpos(lb_fold($c['category']), $qf) !== false)
                    || (strpos(lb_fold($c['shortname']), $qf) !== false);
            }));
        }

        $total = count($courses);
        $pages = max(1, (int)ceil($total/$limit));
        $page  = min($page, $pages);
        $slice = array_slice($courses, ($page-1)*$limit, $limit);

        echo json_encode(['hits'=>$slice,'nbHits'=>$total,'page'=>$page,'nbPages'=>$pages], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE); exit;
    }

    /* ---------- archivos de una carpeta (lazy) ---------- */
    if ($action === 'folderfiles') {
        if ($cmid > 0) {
            $cm     = get_coursemodule_from_id('folder', $cmid, 0, false, MUST_EXIST);
            $ctx    = context_module::instance($cmid);
            require_capability('mod/folder:view', $ctx);
            $children = lb_folder_children_fs($ctx);
        } else if ($contextid > 0) {
            $ctx = context::instance_by_id($contextid, MUST_EXIST);
            if (!$ctx instanceof context_module) {
                throw new moodle_exception('invalidcontext');
            }
            require_capability('mod/folder:view', $ctx);
            $children = lb_folder_children_fs($ctx);
        } else {
            throw new moodle_exception('missingparam', 'error', '', 'cmid/contextid');
        }

        echo json_encode(
            ['children' => $children, 'filecount' => count($children)],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
        exit;
    }

    /* ---------- actividades por curso (incluye match por archivos de folder) ---------- */
    if ($action === 'activities' && $courseid > 0) {
        $course  = get_course($courseid);
        $modinfo = get_fast_modinfo($course);
        $format  = course_get_format($course);
        $sections = [];
        $totales  = [];
        $qf       = lb_fold($q);

        foreach ($modinfo->get_cms() as $cm) {
            if ($cm->deletioninprogress || !$cm->uservisible) { continue; }
            if (in_array($cm->modname, $HIDE_TYPES, true)) { continue; }
            if (!empty($typesfilter) && !in_array($cm->modname, $typesfilter, true)) { continue; }

            $secnum = (int)$cm->sectionnum;
            $totales[$secnum] = ($totales[$secnum] ?? 0) + 1;

            $iconurl = $cm->get_icon_url();
            $icon    = $iconurl ? $iconurl->out(false) : null;

            $include = true;
            $children = [];
            if ($cm->modname === 'folder') {
                $children = lb_folder_children_cm($cm);
                if ($qf !== '') {
                    $children = array_values(array_filter($children, fn($ch)=> lb_match($ch['name'] ?? '', $qf)));
                    $include  = lb_match($cm->name ?? '', $qf) || !empty($children);
                }
            } else {
                $include = ($qf === '') ? true : lb_match($cm->name ?? '', $qf);
            }
            if (!$include) { continue; }

            if (!isset($sections[$secnum])) {
                $secinfo = $modinfo->get_section_info($secnum);
                $secname = $secinfo ? $format->get_section_name($secinfo) : '';
                if ($secname === '' || $secname === null) { $secname = get_string('section').' '.$secnum; }
                $sections[$secnum] = [
                    'sectionnum' => $secnum,
                    'name'       => format_string($secname, true),
                    'activities' => [],
                ];
            }

            $activity = [
                'cmid'    => (int)$cm->id,
                'name'    => (string)$cm->name,
                'modname' => $cm->modname,
                'url'     => $cm->url ? $cm->url->out(false)
                            : (new moodle_url("/mod/{$cm->modname}/view.php", ['id'=>$cm->id]))->out(false),
                'icon'    => $icon,
            ];

            if ($cm->modname === 'folder') {
                if (!empty($children)) {
                    $activity['children']  = $children;         // pre-carga cuando hay query
                    $activity['filecount'] = count($children);
                } else if ($qf === '') {
                    $all = lb_folder_children_cm($cm);          // sin query: todos
                    if (!empty($all)) {
                        $activity['children']  = $all;
                        $activity['filecount'] = count($all);
                    }
                }
            }

            $sections[$secnum]['activities'][] = $activity;
        }

        ksort($sections, SORT_NUMERIC);
        foreach ($sections as $sn => &$s) { $s['total'] = (int)($totales[$sn] ?? count($s['activities'])); }
        $sections = array_values($sections);

        echo json_encode(['sections'=>$sections,'nbSections'=>count($sections)], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE); exit;
    }

    /* ---------- búsqueda global (devuelve archivos coincidentes de folder) ---------- */
    if ($action === 'search') {
        $limit = min(500, max(1, (int)optional_param('limit',100,PARAM_INT)));
        $results = [];
        $qf = lb_fold($q);

        if ( ($qf === '' || core_text::strlen($qf) < 2) && empty($typesfilter) ) {
            echo json_encode(['results'=>[]], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE); exit;
        }

        $enrolled = enrol_get_my_courses(['id','fullname'], 'fullname ASC');
        foreach ($enrolled as $c) {
            if (count($results) >= $limit) { break; }
            if (!empty($coursesfilter) && !in_array((int)$c->id, $coursesfilter, true)) { continue; }

            $modinfo = get_fast_modinfo($c);
            $format  = course_get_format($c);

            foreach ($modinfo->get_cms() as $cm) {
                if ($cm->deletioninprogress || !$cm->uservisible) { continue; }
                if (in_array($cm->modname, $HIDE_TYPES, true)) { continue; }
                if (!empty($typesfilter) && !in_array($cm->modname, $typesfilter, true)) { continue; }

                $secnum  = (int)$cm->sectionnum;
                $secinfo = $modinfo->get_section_info($secnum);
                $secname = $secinfo ? $format->get_section_name($secinfo) : '';
                $iconurl = $cm->get_icon_url();
                $icon    = $iconurl ? $iconurl->out(false) : null;

                if ($cm->modname === 'folder' && $qf !== '') {
                    $children = lb_folder_children_cm($cm);
                    $matched  = array_values(array_filter($children, fn($ch)=> lb_match($ch['name'] ?? '', $qf)));

                    if (!empty($matched)) {
                        foreach ($matched as $ch) {
                            $results[] = [
                                'cmid'       => (int)$cm->id,
                                'courseid'   => (int)$c->id,
                                'coursename' => format_string($c->fullname, true),
                                'section'    => format_string($secname, true),
                                'name'       => (string)($cm->name.' / '.$ch['name']),
                                'modname'    => 'file',     // hijo de folder
                                'url'        => $ch['url'], // pluginfile inline
                                'icon'       => $ch['icon'],
                                'isfile'     => 1
                            ];
                            if (count($results) >= $limit) { break 3; }
                        }
                        continue; // ya agregamos archivos coincidentes
                    }

                    if ($qf !== '' && !lb_match($cm->name ?? '', $qf)) { continue; }
                } else {
                    if ($qf !== '' && core_text::strlen($qf) >= 2 && !lb_match($cm->name ?? '', $qf)) { continue; }
                }

                $results[] = [
                    'cmid'       => (int)$cm->id,
                    'courseid'   => (int)$c->id,
                    'coursename' => format_string($c->fullname, true),
                    'section'    => format_string($secname, true),
                    'name'       => (string)$cm->name,
                    'modname'    => $cm->modname,
                    'url'        => $cm->url ? $cm->url->out(false)
                                    : (new moodle_url("/mod/{$cm->modname}/view.php", ['id'=>$cm->id]))->out(false),
                    'icon'       => $icon
                ];
                if (count($results) >= $limit) { break; }
            }
        }

        echo json_encode(['results'=>$results], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE); exit;
    }

    throw new moodle_exception('invalidrequest');

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error'=>true,'message'=>$e->getMessage()], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE); exit;
}
