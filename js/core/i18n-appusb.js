/* Strings of the apps saved on a USB drive for when the internet fails (js/core/app-usb.js, Control Panel > System). */
(function () {
    'use strict';
    I18n.add({
        en: {
            auUpdTitle: 'Update available', auUpdText: 'Version %v of %s is ready. This TV has version %o installed.', auUpdNow: 'Update', auUpdLater: 'Later',
            auInstalling: 'Installing version %v…', auInstalled: 'Installed · version %v', auInstallFail: 'Could not install the update: opening it online',
            auUpdMode: 'App updates', auUpdModeDesc: 'When a new version of an installed app comes out. Ask me: "Update available" when it opens (Later opens the installed version). Install automatically: installed at once with a progress bar.', auUpdMode_ask: 'Ask me', auUpdMode_auto: 'Install automatically',
            auOn: 'Save apps on a USB drive',
            auOnDesc: 'Apps and games from the App Store that you open are saved on a plugged USB drive (folder MyPC/apps) and saved again when a new version comes out. They open from the drive only when the internet does not work; online, the online version always opens. The list of an app\'s files is read from GitHub.',
            auNone: 'No app saved yet: open an app or game from the App Store while a USB drive is plugged in.',
            auSaved: 'Version %v saved on %d', auSaving: 'Saving on the USB drive... %p%', auChecking: 'Checking for a new version...',
            auWait_nousb: 'Waiting for a USB drive', auWait_offline: 'Waiting for the internet', auWait_network: 'Waiting for the internet', auWait_limit: 'GitHub is busy: tried again later',
            auWait_gone: 'The USB drive was removed', auErr_full: 'The USB drive is full', auErr_off: 'Its maker does not let it be saved',
            auErr_too: 'Too big to save (over 1 GB)', auErr: 'Could not be saved', auRemove: 'Remove the saved copy',
            auDone: '%s is saved on %d for when the internet does not work.',
            auOpened: 'No internet: %s opened from the copy saved on %d (version %v).',
            auUsbFailed: '%s could not start from %d, so it opened online. Next time it opens online too.'
        },
        fr: {
            auUpdTitle: 'Mise à jour disponible', auUpdText: 'La version %v de %s est prête. Ce téléviseur a la version %o installée.', auUpdNow: 'Mettre à jour', auUpdLater: 'Plus tard',
            auInstalling: 'Installation de la version %v…', auInstalled: 'Installée · version %v', auInstallFail: 'Impossible d\'installer la mise à jour : ouverture en ligne',
            auUpdMode: 'Mises à jour des applications', auUpdModeDesc: 'Quand une nouvelle version d\'une application installée sort. Me demander : « Mise à jour disponible » à l\'ouverture (Plus tard ouvre la version installée). Installer automatiquement : installée tout de suite avec une barre de progression.', auUpdMode_ask: 'Me demander', auUpdMode_auto: 'Installer automatiquement',
            auOn: 'Enregistrer les applis sur une clé USB',
            auOnDesc: 'Les applis et jeux de l\'App Store que vous ouvrez sont enregistrés sur la clé USB branchée (dossier MyPC/apps), puis de nouveau à chaque nouvelle version. Ils s\'ouvrent depuis la clé seulement quand internet ne fonctionne pas ; en ligne, c\'est toujours la version en ligne qui s\'ouvre. La liste des fichiers d\'une appli est lue sur GitHub.',
            auNone: 'Aucune appli enregistrée : ouvrez une appli ou un jeu de l\'App Store avec une clé USB branchée.',
            auSaved: 'Version %v enregistrée sur %d', auSaving: 'Enregistrement sur la clé USB... %p %', auChecking: 'Recherche d\'une nouvelle version...',
            auWait_nousb: 'En attente d\'une clé USB', auWait_offline: 'En attente d\'internet', auWait_network: 'En attente d\'internet', auWait_limit: 'GitHub est occupé : nouvel essai plus tard',
            auWait_gone: 'La clé USB a été retirée', auErr_full: 'La clé USB est pleine', auErr_off: 'Son créateur ne permet pas de l\'enregistrer',
            auErr_too: 'Trop grande pour être enregistrée (plus de 1 Go)', auErr: 'Enregistrement impossible', auRemove: 'Supprimer la copie enregistrée',
            auDone: '%s est enregistré sur %d pour quand internet ne fonctionne pas.',
            auOpened: 'Pas d\'internet : %s ouvert depuis la copie enregistrée sur %d (version %v).',
            auUsbFailed: "%s n'a pas pu démarrer depuis %d : ouvert en ligne. La prochaine fois aussi, il s'ouvrira en ligne."
        },
        es: {
            auUpdTitle: 'Actualización disponible', auUpdText: 'La versión %v de %s está lista. Este televisor tiene instalada la versión %o.', auUpdNow: 'Actualizar', auUpdLater: 'Más tarde',
            auInstalling: 'Instalando la versión %v…', auInstalled: 'Instalada · versión %v', auInstallFail: 'No se pudo instalar la actualización: se abre en línea',
            auUpdMode: 'Actualizaciones de apps', auUpdModeDesc: 'Cuando sale una nueva versión de una app instalada. Preguntarme: «Actualización disponible» al abrirla (Más tarde abre la versión instalada). Instalar automáticamente: se instala enseguida con una barra de progreso.', auUpdMode_ask: 'Preguntarme', auUpdMode_auto: 'Instalar automáticamente',
            auOn: 'Guardar las apps en una memoria USB',
            auOnDesc: 'Las apps y juegos de la App Store que abres se guardan en la memoria USB conectada (carpeta MyPC/apps) y se guardan otra vez con cada versión nueva. Se abren desde la memoria solo cuando internet no funciona; con conexión siempre se abre la versión en línea. La lista de archivos de una app se lee en GitHub.',
            auNone: 'Ninguna app guardada: abre una app o un juego de la App Store con una memoria USB conectada.',
            auSaved: 'Versión %v guardada en %d', auSaving: 'Guardando en la memoria USB... %p %', auChecking: 'Buscando una versión nueva...',
            auWait_nousb: 'Esperando una memoria USB', auWait_offline: 'Esperando internet', auWait_network: 'Esperando internet', auWait_limit: 'GitHub está ocupado: se intentará más tarde',
            auWait_gone: 'Se quitó la memoria USB', auErr_full: 'La memoria USB está llena', auErr_off: 'Su creador no permite guardarla',
            auErr_too: 'Demasiado grande para guardarla (más de 1 GB)', auErr: 'No se pudo guardar', auRemove: 'Borrar la copia guardada',
            auDone: '%s está guardado en %d para cuando internet no funcione.',
            auOpened: 'Sin internet: %s se abrió desde la copia guardada en %d (versión %v).',
            auUsbFailed: '%s no pudo iniciarse desde %d: se abrió en línea. La próxima vez también se abrirá en línea.'
        },
        ar: {
            auUpdTitle: 'تحديث متوفر', auUpdText: 'الإصدار %v من %s جاهز. هذا التلفاز مثبت عليه الإصدار %o.', auUpdNow: 'تحديث', auUpdLater: 'لاحقًا',
            auInstalling: 'جارٍ تثبيت الإصدار %v…', auInstalled: 'تم التثبيت · الإصدار %v', auInstallFail: 'تعذر تثبيت التحديث: سيتم فتحه عبر الإنترنت',
            auUpdMode: 'تحديثات التطبيقات', auUpdModeDesc: 'عند صدور إصدار جديد من تطبيق مثبت. اسألني: «تحديث متوفر» عند فتحه (لاحقًا يفتح الإصدار المثبت). التثبيت تلقائيًا: يُثبت فورًا مع شريط تقدم.', auUpdMode_ask: 'اسألني', auUpdMode_auto: 'التثبيت تلقائيًا',
            auOn: 'حفظ التطبيقات على ذاكرة USB',
            auOnDesc: 'تُحفظ تطبيقات وألعاب متجر التطبيقات التي تفتحها على ذاكرة USB الموصولة (مجلد MyPC/apps)، وتُحفظ من جديد عند صدور إصدار جديد. تُفتح من الذاكرة فقط عندما لا يعمل الإنترنت؛ مع الإنترنت يُفتح دائمًا الإصدار المباشر. تُقرأ قائمة ملفات التطبيق من GitHub.',
            auNone: 'لا يوجد تطبيق محفوظ بعد: افتح تطبيقًا أو لعبة من المتجر وذاكرة USB موصولة.',
            auSaved: 'الإصدار %v محفوظ على %d', auSaving: 'جارٍ الحفظ على ذاكرة USB... %p%', auChecking: 'جارٍ البحث عن إصدار جديد...',
            auWait_nousb: 'في انتظار ذاكرة USB', auWait_offline: 'في انتظار الإنترنت', auWait_network: 'في انتظار الإنترنت', auWait_limit: 'GitHub مشغول: ستُعاد المحاولة لاحقًا',
            auWait_gone: 'أُزيلت ذاكرة USB', auErr_full: 'ذاكرة USB ممتلئة', auErr_off: 'صانعه لا يسمح بحفظه',
            auErr_too: 'أكبر من أن يُحفظ (أكثر من 1 غيغابايت)', auErr: 'تعذّر الحفظ', auRemove: 'حذف النسخة المحفوظة',
            auDone: 'تم حفظ %s على %d لاستخدامه عندما لا يعمل الإنترنت.',
            auOpened: 'لا يوجد إنترنت: فُتح %s من النسخة المحفوظة على %d (الإصدار %v).',
            auUsbFailed: 'تعذر تشغيل %s من %d، فتم فتحه عبر الإنترنت. وسيُفتح عبر الإنترنت في المرة القادمة أيضاً.'
        }
    });
})();
