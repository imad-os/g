/* Strings of the copies between Google Drive and USB drives (js/core/copy-jobs.js: the progress card) and of MyPC.usb's
 * permission question (js/launcher/bridges.js), in the 4 languages. */
(function () {
    'use strict';
    I18n.add({
        en: {
            cpToUsb: 'Copying to %s', cpToDrive: 'Copying to Google Drive: %s', cpMyDrive: 'My Drive',
            cpScanning: 'Getting the list of files…', cpProgress: 'File %1 of %2 · %3%', cpWaiting: 'Waiting for the internet…', cpPaused: 'Paused',
            cpDoneTitle: 'Copy finished', cpDone: '%1 files copied to %2.', cpDone1: '1 file copied to %2.', cpSkipped: '%s were already there or skipped.', cpFailedN: '%s could not be copied.',
            cpStopped: 'Copy stopped', cpErrGone: 'The USB drive was removed. Plug it in again and start the copy again.', cpErrFull: 'The USB drive is full.',
            cpErrDriveFull: 'Your Google Drive is full.', cpErrPerm: 'This TV needs the newer My PC package (1.6.0 or newer) to use USB drives.',
            cpErrSignIn: 'Sign in to Google Drive again (Control Panel > Google Drive).', cpErrTooMany: 'Too many files: 20,000 at most in one copy.', cpErr: 'Something went wrong: %s',
            cpStopQ: 'Stop this copy?', cpStop: 'Stop copying', cpKeep: 'Keep copying',
            permUsbTitle: '%s wants to use your USB drives',
            permUsbText: 'It can see the files and folders on the USB drives plugged into this TV, open them, and add new ones there.'
        },
        fr: {
            cpToUsb: 'Copie vers %s', cpToDrive: 'Copie vers Google Drive : %s', cpMyDrive: 'Mon Drive',
            cpScanning: 'Liste des fichiers…', cpProgress: 'Fichier %1 sur %2 · %3 %', cpWaiting: 'En attente d’Internet…', cpPaused: 'En pause',
            cpDoneTitle: 'Copie terminée', cpDone: '%1 fichiers copiés vers %2.', cpDone1: '1 fichier copié vers %2.', cpSkipped: '%s étaient déjà là ou ont été ignorés.', cpFailedN: '%s n’ont pas pu être copiés.',
            cpStopped: 'Copie arrêtée', cpErrGone: 'La clé USB a été retirée. Rebranchez-la et relancez la copie.', cpErrFull: 'La clé USB est pleine.',
            cpErrDriveFull: 'Votre Google Drive est plein.', cpErrPerm: 'Ce téléviseur a besoin du nouveau paquet My PC (1.6.0 ou plus récent) pour utiliser les clés USB.',
            cpErrSignIn: 'Reconnectez-vous à Google Drive (Panneau de configuration > Google Drive).', cpErrTooMany: 'Trop de fichiers : 20 000 au maximum par copie.', cpErr: 'Un problème est survenu : %s',
            cpStopQ: 'Arrêter cette copie ?', cpStop: 'Arrêter la copie', cpKeep: 'Continuer',
            permUsbTitle: '%s veut utiliser vos clés USB',
            permUsbText: 'Elle peut voir les fichiers et dossiers des clés USB branchées sur ce téléviseur, les ouvrir et en ajouter.'
        },
        es: {
            cpToUsb: 'Copiando a %s', cpToDrive: 'Copiando a Google Drive: %s', cpMyDrive: 'Mi unidad',
            cpScanning: 'Obteniendo la lista de archivos…', cpProgress: 'Archivo %1 de %2 · %3 %', cpWaiting: 'Esperando a Internet…', cpPaused: 'En pausa',
            cpDoneTitle: 'Copia terminada', cpDone: '%1 archivos copiados a %2.', cpDone1: '1 archivo copiado a %2.', cpSkipped: '%s ya estaban o se omitieron.', cpFailedN: '%s no se pudieron copiar.',
            cpStopped: 'Copia detenida', cpErrGone: 'Se quitó la memoria USB. Vuelve a conectarla y empieza la copia otra vez.', cpErrFull: 'La memoria USB está llena.',
            cpErrDriveFull: 'Tu Google Drive está lleno.', cpErrPerm: 'Este televisor necesita el paquete nuevo de My PC (1.6.0 o posterior) para usar memorias USB.',
            cpErrSignIn: 'Vuelve a iniciar sesión en Google Drive (Panel de control > Google Drive).', cpErrTooMany: 'Demasiados archivos: 20 000 como máximo por copia.', cpErr: 'Algo salió mal: %s',
            cpStopQ: '¿Detener esta copia?', cpStop: 'Detener la copia', cpKeep: 'Seguir copiando',
            permUsbTitle: '%s quiere usar tus memorias USB',
            permUsbText: 'Puede ver los archivos y carpetas de las memorias USB conectadas a este televisor, abrirlos y añadir otros nuevos.'
        },
        ar: {
            cpToUsb: 'جارٍ النسخ إلى %s', cpToDrive: 'جارٍ النسخ إلى Google Drive: %s', cpMyDrive: 'ملفاتي',
            cpScanning: 'جارٍ جلب قائمة الملفات…', cpProgress: 'الملف %1 من %2 · %3%', cpWaiting: 'في انتظار الإنترنت…', cpPaused: 'متوقف مؤقتًا',
            cpDoneTitle: 'انتهى النسخ', cpDone: 'تم نسخ %1 ملفات إلى %2.', cpDone1: 'تم نسخ ملف واحد إلى %2.', cpSkipped: '%s كانت موجودة أو تم تخطيها.', cpFailedN: 'تعذر نسخ %s.',
            cpStopped: 'توقف النسخ', cpErrGone: 'تمت إزالة وحدة USB. أعد توصيلها وابدأ النسخ من جديد.', cpErrFull: 'وحدة USB ممتلئة.',
            cpErrDriveFull: 'مساحة Google Drive ممتلئة.', cpErrPerm: 'يحتاج هذا التلفاز إلى حزمة My PC الأحدث (1.6.0 أو أحدث) لاستخدام وحدات USB.',
            cpErrSignIn: 'سجّل الدخول إلى Google Drive مرة أخرى (لوحة التحكم > Google Drive).', cpErrTooMany: 'ملفات كثيرة جدًا: 20000 كحد أقصى في النسخة الواحدة.', cpErr: 'حدث خطأ: %s',
            cpStopQ: 'إيقاف هذا النسخ؟', cpStop: 'إيقاف النسخ', cpKeep: 'متابعة النسخ',
            permUsbTitle: 'يريد %s استخدام وحدات USB',
            permUsbText: 'يمكنه رؤية الملفات والمجلدات في وحدات USB الموصولة بهذا التلفاز وفتحها وإضافة ملفات جديدة إليها.'
        }
    });
})();
