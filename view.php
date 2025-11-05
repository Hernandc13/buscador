<?php
require('../../config.php');

require_login();
$context = context_system::instance();
require_capability('local/buscador:view', $context);

$PAGE->set_context($context);
$PAGE->set_url(new moodle_url('/local/buscador/view.php'));
$PAGE->set_pagelayout('popup');
$PAGE->set_title(get_string('pluginname', 'local_buscador'));
$PAGE->set_heading(get_string('pluginname', 'local_buscador'));

$endpoint    = (new moodle_url('/local/buscador/ajax.php'))->out(false);
$defaulticon = $OUTPUT->image_url('i/info')->out(false);

// SVG locales
$svgsearch = (new moodle_url('/local/buscador/svg/search.svg'))->out(false);
$svgdown   = (new moodle_url('/local/buscador/svg/abajo.svg'))->out(false);
$svgup     = (new moodle_url('/local/buscador/svg/arriba.svg'))->out(false);

$payload = [
    'wwwroot'           => $CFG->wwwroot,
    'endpoint'          => $endpoint,
    'sesskey'           => sesskey(),
    'defaulticon'       => $defaulticon,
    'svgsearch'         => $svgsearch,
    'svgdown'           => $svgdown,
    'svgup'             => $svgup,
    'heading'           => get_string('heading', 'local_buscador'),
    'close'             => get_string('close', 'local_buscador'),
    'searchactivities'  => get_string('searchactivities', 'local_buscador'),
    'coursefilter'      => get_string('coursefilter', 'local_buscador'),
    'searchplaceholder' => get_string('searchplaceholder', 'local_buscador'),
    'clear'             => get_string('clear', 'local_buscador'),
    'empty'             => get_string('empty', 'local_buscador'),
    'loading'           => get_string('loading', 'local_buscador'),
    'sections'          => get_string('sections', 'local_buscador'),
    'nosections'        => get_string('nosections', 'local_buscador'),
    'typefilter'        => get_string('typefilter', 'local_buscador'),
    'searchtypes'       => get_string('searchtypes', 'local_buscador'),
];


$embed = optional_param('embed', 0, PARAM_BOOL);
if ($embed) {
    @header('Content-Type: text/html; charset=utf-8');
    echo $OUTPUT->render_from_template('local_buscador/main', $payload);
    exit;
}


$PAGE->requires->css(new moodle_url('/local/buscador/assets/buscador.css'));
$PAGE->requires->js(new moodle_url('/local/buscador/assets/buscador.js'), true);
$PAGE->requires->css(new moodle_url('https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css'));

echo $OUTPUT->header();
echo $OUTPUT->render_from_template('local_buscador/main', $payload);
echo $OUTPUT->footer();
