<?php
defined('MOODLE_INTERNAL') || die();

function local_buscador_before_http_headers() {
    global $CFG;
    if (!isloggedin() || isguestuser()) { return; }

    $label = "\u{200B}"; 
    $url   = (new moodle_url('/local/buscador/view.php'))->out(false);

    $items = trim((string)($CFG->custommenuitems ?? ''));
    if (strpos($items, $url) === false) {
        $CFG->custommenuitems = $items === '' ? "{$label}|{$url}" : "{$items}\n{$label}|{$url}";
    }
}

function local_buscador_extend_navigation(global_navigation $nav) {
    global $PAGE;
    $PAGE->requires->js(new moodle_url('/local/buscador/assets/navicon.js'));
    $PAGE->requires->css(new moodle_url('/local/buscador/assets/navicon.css'));
}
