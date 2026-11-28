/* Strings of "open in My PC's apps" (MyPC.open, API 25, owner request 2026-11-27): an app (MyDrive) opens a picture in MyPhotos,
 * a video in MyVideos, a song in MyMusic (js/launcher/app-open.js); Back there returns to the app. */
(function () {
    'use strict';
    I18n.add({
        en: {
            opHint: 'Left / Right: other pictures · Down: buttons · Back: return to %s',
            opNoPic: 'This picture cannot be shown on this TV.',
            opLoad: 'Loading…',
            opLoadPc: 'Loading… %n%',
            opVidFail: 'The video could not be opened (%s).'
        },
        fr: {
            opHint: 'Gauche / Droite : autres images · Bas : boutons · Retour : revenir à %s',
            opNoPic: 'Cette image ne peut pas être affichée sur cette TV.',
            opLoad: 'Chargement…',
            opLoadPc: 'Chargement… %n %',
            opVidFail: 'La vidéo n’a pas pu être ouverte (%s).'
        },
        es: {
            opHint: 'Izquierda / Derecha: otras imágenes · Abajo: botones · Atrás: volver a %s',
            opNoPic: 'Esta imagen no se puede mostrar en esta TV.',
            opLoad: 'Cargando…',
            opLoadPc: 'Cargando… %n %',
            opVidFail: 'No se pudo abrir el vídeo (%s).'
        },
        ar: {
            opHint: 'يسار / يمين: صور أخرى · أسفل: الأزرار · رجوع: العودة إلى %s',
            opNoPic: 'لا يمكن عرض هذه الصورة على هذا التلفاز.',
            opLoad: 'جارٍ التحميل…',
            opLoadPc: 'جارٍ التحميل… %n٪',
            opVidFail: 'تعذر فتح الفيديو (%s).'
        }
    });
})();
