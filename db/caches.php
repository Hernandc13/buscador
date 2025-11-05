<?php
defined('MOODLE_INTERNAL') || die();

$definitions = [
    'courses' => [
        'mode' => cache_store::MODE_APPLICATION,
        'simplekeys' => true,
        'simpledata' => true,
        'ttl' => 300
    ],
];
