<?php
defined('MOODLE_INTERNAL') || die();

$functions = [
    'local_buscador_get_courses' => [
        'classname'   => 'local_buscador\\external',
        'methodname'  => 'get_courses',
        'description' => 'Lista de cursos del usuario (Áreas de estudio) con búsqueda y paginación',
        'type'        => 'read',
        'ajax'        => true,
        'capabilities'=> 'local/buscador:view',
    ],
    'local_buscador_get_activities' => [
        'classname'   => 'local_buscador\\external',
        'methodname'  => 'get_activities',
        'description' => 'Secciones + actividades visibles para el usuario en un curso',
        'type'        => 'read',
        'ajax'        => true,
        'capabilities'=> 'local/buscador:view',
    ],
];
