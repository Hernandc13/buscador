<?php
namespace local_buscador;

defined('MOODLE_INTERNAL') || die();

use external_api;
use external_value;
use external_single_structure;
use external_multiple_structure;
use external_function_parameters;

class external extends external_api {

    public static function get_courses_parameters(): external_function_parameters {
        return new external_function_parameters([
            'q'     => new external_value(PARAM_RAW_TRIMMED, 'Filtro por texto (opcional)', VALUE_DEFAULT, ''),
            'page'  => new external_value(PARAM_INT, 'Página (1..N)', VALUE_DEFAULT, 1),
            'limit' => new external_value(PARAM_INT, 'Límite por página (<=200)', VALUE_DEFAULT, 24),
        ]);
    }

    public static function get_courses(string $q = '', int $page = 1, int $limit = 24): array {
        global $USER;
        require_login();
        self::validate_context(\context_system::instance());
        require_capability('local/buscador:view', \context_system::instance());
        \core\session\manager::write_close();

        $q     = \core_text::strtolower(trim($q));
        $page  = max(1, $page);
        $limit = min(200, max(1, $limit));

        $cachekey = "u{$USER->id}";
        $cache = \cache::make('local_buscador', 'courses');
        $courses = $cache->get($cachekey);
        if ($courses === false) {
            $enrolled = enrol_get_my_courses(['id','fullname','shortname','category'], 'fullname ASC');
            $courses = [];
            foreach ($enrolled as $c) {
                $catname = '';
                if ($c->category) {
                    try {
                        $cat = \core_course_category::get($c->category, IGNORE_MISSING, true);
                        $catname = $cat ? $cat->get_formatted_name() : '';
                    } catch (\Throwable $e) { $catname = ''; }
                }
                $courses[] = [
                    'courseid'   => (int)$c->id,
                    'coursename' => format_string($c->fullname, true),
                    'category'   => format_string($catname, true),
                    'url'        => (new \moodle_url('/course/view.php', ['id'=>$c->id]))->out(false),
                ];
            }
            $cache->set($cachekey, $courses);
        }

        if ($q !== '') {
            $ql = \core_text::strtolower($q);
            $courses = array_values(array_filter($courses, function($c) use($ql){
                return (strpos(\core_text::strtolower($c['coursename']), $ql) !== false)
                    || (strpos(\core_text::strtolower($c['category']),   $ql) !== false);
            }));
        }

        $total = count($courses);
        $pages = max(1, (int)ceil($total/$limit));
        $page  = min($page, $pages);
        $slice = array_slice($courses, ($page-1)*$limit, $limit);

        return [
            'hits'    => $slice,
            'nbHits'  => $total,
            'page'    => $page,
            'nbPages' => $pages,
        ];
    }

    public static function get_courses_returns() {
        return new external_single_structure([
            'hits' => new external_multiple_structure(new external_single_structure([
                'courseid'   => new external_value(PARAM_INT,  'ID del curso'),
                'coursename' => new external_value(PARAM_TEXT, 'Nombre del curso'),
                'category'   => new external_value(PARAM_TEXT, 'Nombre de categoría'),
                'url'        => new external_value(PARAM_URL,  'URL del curso'),
            ])),
            'nbHits'  => new external_value(PARAM_INT, 'Total'),
            'page'    => new external_value(PARAM_INT, 'Página actual'),
            'nbPages' => new external_value(PARAM_INT, 'Páginas'),
        ]);
    }

    public static function get_activities_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'ID curso'),
            'q'        => new external_value(PARAM_RAW_TRIMMED, 'Filtro (opcional)', VALUE_DEFAULT, ''),
            'types'    => new external_value(PARAM_RAW_TRIMMED, 'CSV de tipos (modname) opcional', VALUE_DEFAULT, ''),
        ]);
    }

    public static function get_activities(int $courseid, string $q = '', string $types = ''): array {
        require_login();
        $course  = get_course($courseid);
        $context = \context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/buscador:view', \context_system::instance());
        \core\session\manager::write_close();

        $q = \core_text::strtolower(trim($q));
        $typesfilter = [];
        foreach (preg_split('/[,\s]+/', \core_text::strtolower(trim($types)), -1, PREG_SPLIT_NO_EMPTY) as $t) {
            if (preg_match('/^[a-z0-9_]+$/', $t)) { $typesfilter[$t] = true; }
        }

        $modinfo = get_fast_modinfo($course);
        $format  = course_get_format($course);

        $sections = [];
        $totales  = [];

        foreach ($modinfo->get_cms() as $cm) {
            if ($cm->deletioninprogress || !$cm->uservisible) { continue; }
            if (!empty($typesfilter) && empty($typesfilter[$cm->modname])) { continue; }

            $secnum = (int)$cm->sectionnum;
            $totales[$secnum] = ($totales[$secnum] ?? 0) + 1;

            if ($q !== '' && strpos(\core_text::strtolower((string)$cm->name), $q) === false) { continue; }

            if (!isset($sections[$secnum])) {
                $secinfo = $modinfo->get_section_info($secnum);
                $secname = $secinfo ? $format->get_section_name($secinfo) : '';
                if ($secname === '' || $secname === null) { $secname = get_string('section') . ' ' . $secnum; }
                $sections[$secnum] = [
                    'sectionnum' => $secnum,
                    'name'       => format_string($secname, true),
                    'activities' => [],
                ];
            }

            $iconurl = $cm->get_icon_url();
            $icon = $iconurl ? $iconurl->out(false) : null;

            $sections[$secnum]['activities'][] = [
                'name'    => (string)$cm->name,
                'modname' => $cm->modname,
                'url'     => $cm->url ? $cm->url->out(false)
                                      : (new \moodle_url("/mod/{$cm->modname}/view.php", ['id'=>$cm->id]))->out(false),
                'icon'    => $icon,
            ];
        }

        ksort($sections, SORT_NUMERIC);
        foreach ($sections as $sn => &$s) {
            $s['total'] = (int)($totales[$sn] ?? count($s['activities']));
        }
        $sections = array_values($sections);

        return ['sections'=>$sections, 'nbSections'=>count($sections)];
    }

    public static function get_activities_returns() {
        return new external_single_structure([
            'sections' => new external_multiple_structure(new external_single_structure([
                'sectionnum' => new external_value(PARAM_INT, 'Núm. sección'),
                'name'       => new external_value(PARAM_TEXT,'Nombre de sección'),
                'total'      => new external_value(PARAM_INT, 'Total actividades en sección'),
                'activities' => new external_multiple_structure(new external_single_structure([
                    'name'    => new external_value(PARAM_TEXT, 'Nombre actividad'),
                    'modname' => new external_value(PARAM_ALPHANUMEXT, 'Tipo'),
                    'url'     => new external_value(PARAM_URL, 'URL'),
                    'icon'    => new external_value(PARAM_RAW_TRIMMED, 'URL del ícono nativo', VALUE_OPTIONAL),
                ])),
            ])),
            'nbSections' => new external_value(PARAM_INT, 'Secciones devueltas'),
        ]);
    }
}
