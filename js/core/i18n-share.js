/* Strings of Share to the TV (owner request 2026-11-13): the TV's Receiver app and the phone's Send to TV screen
 * (js/launcher/apps/receiver.js, js/launcher/share-rx.js) and the apps that open what arrives: MyPhotos, MyNotes, MyVideos.
 * Keep rxPrivacy true: on this Wi-Fi nothing goes through the internet; over the internet a share waits in Firestore (share/<TV code>,
 * at most a day, deleted when the TV takes it). */
(function () {
    'use strict';
    I18n.add({
        en: {
            receiver: 'Receiver', sendtv: 'Send to TV', photos: 'MyPhotos', notes: 'MyNotes', videos: 'MyVideos',
            rxTitle: 'Receive from a phone', rxHelp: 'On your phone, share a photo, video, song, link or text and pick "Send to TV (My PC)" (the My PC app for Android). This TV finds the phone on your home network by itself.',
            rxLooking: 'Looking for phones on your network… %n%', rxNoPhone: 'No phone found yet. The phone must be on the same Wi-Fi as the TV, with the My PC app open.',
            rxReady: 'Ready for %s', rxNoNet: 'This TV is not on a network. Connect it to your Wi-Fi or router first.', rxAddr: 'This TV: %s',
            rxScan: 'Look again', rxManual: 'Type the phone\'s address', rxManualHint: 'The address shown on the phone, like 192.168.1.23', rxBadAddr: 'No My PC phone answers at %s.',
            rxStop: 'Stop receiving', rxStart: 'Start receiving', rxOn: 'Receiving: what your phone sends opens here, even with this window closed (until a game or app opens).',
            rxOff: 'Not receiving.', rxGot: 'From %s', rxHistory: 'Received', rxNone: 'Nothing received yet.', rxOpen: 'Open',
            rxCant: 'My PC cannot open this kind of file: %s', rxFail: 'Could not take it from the phone.', rxPhoneGone: '%s left',
            rxPhoto: 'Photo', rxVideo: 'Video', rxSong: 'Song', rxLink: 'Link', rxText: 'Text', rxFile: 'File',
            rxTray: 'Receiver is on: this TV takes what your phones send',
            stPick: 'Send to %s', stAlways: 'Always send to this TV', stAuto: 'Goes to %s by itself', stForget: 'Stop sending by itself',
            stState_wait: 'Waiting', stState_sent: 'Sending…', stState_taken: 'Opened on the TV', stState_failed: 'The TV could not open it',
            stAddr: 'This phone: %s', stNoWifi: 'This phone is not on a Wi-Fi network.', stTypeText: 'Send a text or a link', stClear: 'Clear the list',
            stRemove: 'Remove', stNone: 'Nothing to send. In any app, share a photo, video, song, link or text and pick "Send to TV (My PC)".',
            stOld: 'Update the My PC app on this phone to send to the TV.', stTvs: 'TVs with Receiver open', stItems: 'Shared', stOff: 'The phone could not open its port: close and open My PC again.',
            ntNew: 'New note', ntNone: 'No notes yet. Type one, or send a text from your phone (open Receiver).', ntDelete: 'Delete', ntDelSure: 'OK again to delete',
            ntEdit: 'Edit', ntOpenLink: 'Open the link', ntFrom: 'From %s', ntDeleted: 'Note deleted', ntMine: 'Typed here',
            phNone: 'No photos yet. Open Receiver on the TV, then on the phone share photos with "Send to TV (My PC)".', phDelete: 'Delete', phDelSure: 'OK again to delete',
            phCount: '%n photos', phPrev: 'Previous', phNext: 'Next', phTurn: 'Turn', phSlide: 'Slideshow', phHint: 'Left / Right: other photos · OK: buttons · Back: all photos',
            phDeleted: 'Photo deleted', phNoSave: 'The photo could not be saved on the TV.',
            vdNone: 'No videos yet. Open Receiver on the TV, then share a video from the phone: it plays straight from the phone, so keep My PC open there.',
            vdPlay: 'Play', vdPause: 'Pause', vdBack10: '−10 s', vdFwd10: '+10 s', vdGone: 'The phone no longer shares this video: send it again.',
            vdError: 'The video could not play (%s).', vdRemove: 'Remove', vdLoading: 'Opening…', vdHint: 'OK: play / pause · Left / Right: 10 s · Back: list'
        },
        fr: {
            receiver: 'Récepteur', sendtv: 'Envoyer à la TV', photos: 'MyPhotos', notes: 'MyNotes', videos: 'MyVideos',
            rxTitle: 'Recevoir d’un téléphone', rxHelp: 'Sur votre téléphone, partagez une photo, une vidéo, une chanson, un lien ou un texte et choisissez « Envoyer à la TV (My PC) » (l’application My PC pour Android). Cette TV trouve le téléphone toute seule sur votre réseau.',
            rxLooking: 'Recherche des téléphones sur votre réseau… %n %', rxNoPhone: 'Aucun téléphone trouvé. Le téléphone doit être sur le même Wi-Fi que la TV, avec l’application My PC ouverte.',
            rxReady: 'Prêt pour %s', rxNoNet: 'Cette TV n’est sur aucun réseau. Connectez-la d’abord à votre Wi-Fi ou à votre box.', rxAddr: 'Cette TV : %s',
            rxScan: 'Chercher encore', rxManual: 'Saisir l’adresse du téléphone', rxManualHint: 'L’adresse affichée sur le téléphone, par exemple 192.168.1.23', rxBadAddr: 'Aucun téléphone My PC ne répond à %s.',
            rxStop: 'Arrêter la réception', rxStart: 'Recevoir', rxOn: 'Réception active : ce que votre téléphone envoie s’ouvre ici, même fenêtre fermée (jusqu’à l’ouverture d’un jeu ou d’une application).',
            rxOff: 'Réception arrêtée.', rxGot: 'De %s', rxHistory: 'Reçus', rxNone: 'Rien reçu pour l’instant.', rxOpen: 'Ouvrir',
            rxCant: 'My PC ne sait pas ouvrir ce type de fichier : %s', rxFail: 'Impossible de le récupérer depuis le téléphone.', rxPhoneGone: '%s est parti',
            rxPhoto: 'Photo', rxVideo: 'Vidéo', rxSong: 'Chanson', rxLink: 'Lien', rxText: 'Texte', rxFile: 'Fichier',
            rxTray: 'Récepteur actif : cette TV reçoit ce que vos téléphones envoient',
            stPick: 'Envoyer à %s', stAlways: 'Toujours envoyer à cette TV', stAuto: 'Part tout seul vers %s', stForget: 'Ne plus envoyer tout seul',
            stState_wait: 'En attente', stState_sent: 'Envoi…', stState_taken: 'Ouvert sur la TV', stState_failed: 'La TV n’a pas pu l’ouvrir',
            stAddr: 'Ce téléphone : %s', stNoWifi: 'Ce téléphone n’est sur aucun réseau Wi-Fi.', stTypeText: 'Envoyer un texte ou un lien', stClear: 'Vider la liste',
            stRemove: 'Retirer', stNone: 'Rien à envoyer. Dans n’importe quelle application, partagez une photo, une vidéo, une chanson, un lien ou un texte et choisissez « Envoyer à la TV (My PC) ».',
            stOld: 'Mettez à jour l’application My PC de ce téléphone pour envoyer à la TV.', stTvs: 'TV avec Récepteur ouvert', stItems: 'Partagés', stOff: 'Le téléphone n’a pas pu ouvrir son port : fermez puis rouvrez My PC.',
            ntNew: 'Nouvelle note', ntNone: 'Aucune note. Écrivez-en une, ou envoyez un texte depuis votre téléphone (ouvrez Récepteur).', ntDelete: 'Supprimer', ntDelSure: 'OK encore pour supprimer',
            ntEdit: 'Modifier', ntOpenLink: 'Ouvrir le lien', ntFrom: 'De %s', ntDeleted: 'Note supprimée', ntMine: 'Écrite ici',
            phNone: 'Aucune photo. Ouvrez Récepteur sur la TV, puis partagez des photos depuis le téléphone avec « Envoyer à la TV (My PC) ».', phDelete: 'Supprimer', phDelSure: 'OK encore pour supprimer',
            phCount: '%n photos', phPrev: 'Précédente', phNext: 'Suivante', phTurn: 'Pivoter', phSlide: 'Diaporama', phHint: 'Gauche / Droite : autres photos · OK : boutons · Retour : toutes les photos',
            phDeleted: 'Photo supprimée', phNoSave: 'La photo n’a pas pu être enregistrée sur la TV.',
            vdNone: 'Aucune vidéo. Ouvrez Récepteur sur la TV, puis partagez une vidéo depuis le téléphone : elle est lue directement depuis le téléphone, gardez My PC ouvert dessus.',
            vdPlay: 'Lire', vdPause: 'Pause', vdBack10: '−10 s', vdFwd10: '+10 s', vdGone: 'Le téléphone ne partage plus cette vidéo : envoyez-la de nouveau.',
            vdError: 'La vidéo n’a pas pu être lue (%s).', vdRemove: 'Retirer', vdLoading: 'Ouverture…', vdHint: 'OK : lecture / pause · Gauche / Droite : 10 s · Retour : liste'
        },
        es: {
            receiver: 'Receptor', sendtv: 'Enviar a la TV', photos: 'MyPhotos', notes: 'MyNotes', videos: 'MyVideos',
            rxTitle: 'Recibir de un móvil', rxHelp: 'En tu móvil, comparte una foto, un vídeo, una canción, un enlace o un texto y elige «Enviar a la TV (My PC)» (la app My PC para Android). Esta TV encuentra el móvil sola en tu red de casa.',
            rxLooking: 'Buscando móviles en tu red… %n %', rxNoPhone: 'Aún no se ha encontrado ningún móvil. Debe estar en el mismo Wi-Fi que la TV, con la app My PC abierta.',
            rxReady: 'Lista para %s', rxNoNet: 'Esta TV no está en ninguna red. Conéctala primero a tu Wi-Fi o router.', rxAddr: 'Esta TV: %s',
            rxScan: 'Buscar otra vez', rxManual: 'Escribir la dirección del móvil', rxManualHint: 'La dirección que muestra el móvil, como 192.168.1.23', rxBadAddr: 'Ningún móvil con My PC responde en %s.',
            rxStop: 'Dejar de recibir', rxStart: 'Recibir', rxOn: 'Recibiendo: lo que envía tu móvil se abre aquí, aunque cierres esta ventana (hasta que se abra un juego o una app).',
            rxOff: 'Sin recibir.', rxGot: 'De %s', rxHistory: 'Recibido', rxNone: 'Aún no se ha recibido nada.', rxOpen: 'Abrir',
            rxCant: 'My PC no puede abrir este tipo de archivo: %s', rxFail: 'No se pudo traer del móvil.', rxPhoneGone: '%s se ha ido',
            rxPhoto: 'Foto', rxVideo: 'Vídeo', rxSong: 'Canción', rxLink: 'Enlace', rxText: 'Texto', rxFile: 'Archivo',
            rxTray: 'Receptor activo: esta TV recibe lo que envían tus móviles',
            stPick: 'Enviar a %s', stAlways: 'Enviar siempre a esta TV', stAuto: 'Va sola a %s', stForget: 'Dejar de enviar sola',
            stState_wait: 'Esperando', stState_sent: 'Enviando…', stState_taken: 'Abierto en la TV', stState_failed: 'La TV no pudo abrirlo',
            stAddr: 'Este móvil: %s', stNoWifi: 'Este móvil no está en ninguna red Wi-Fi.', stTypeText: 'Enviar un texto o un enlace', stClear: 'Vaciar la lista',
            stRemove: 'Quitar', stNone: 'Nada que enviar. En cualquier app, comparte una foto, un vídeo, una canción, un enlace o un texto y elige «Enviar a la TV (My PC)».',
            stOld: 'Actualiza la app My PC de este móvil para enviar a la TV.', stTvs: 'TV con Receptor abierto', stItems: 'Compartido', stOff: 'El móvil no pudo abrir su puerto: cierra y vuelve a abrir My PC.',
            ntNew: 'Nueva nota', ntNone: 'Aún no hay notas. Escribe una, o envía un texto desde tu móvil (abre Receptor).', ntDelete: 'Borrar', ntDelSure: 'OK otra vez para borrar',
            ntEdit: 'Editar', ntOpenLink: 'Abrir el enlace', ntFrom: 'De %s', ntDeleted: 'Nota borrada', ntMine: 'Escrita aquí',
            phNone: 'Aún no hay fotos. Abre Receptor en la TV y comparte fotos desde el móvil con «Enviar a la TV (My PC)».', phDelete: 'Borrar', phDelSure: 'OK otra vez para borrar',
            phCount: '%n fotos', phPrev: 'Anterior', phNext: 'Siguiente', phTurn: 'Girar', phSlide: 'Presentación', phHint: 'Izquierda / Derecha: otras fotos · OK: botones · Atrás: todas las fotos',
            phDeleted: 'Foto borrada', phNoSave: 'No se pudo guardar la foto en la TV.',
            vdNone: 'Aún no hay vídeos. Abre Receptor en la TV y comparte un vídeo desde el móvil: se reproduce directamente desde el móvil, así que deja My PC abierto en él.',
            vdPlay: 'Reproducir', vdPause: 'Pausa', vdBack10: '−10 s', vdFwd10: '+10 s', vdGone: 'El móvil ya no comparte este vídeo: envíalo otra vez.',
            vdError: 'El vídeo no se pudo reproducir (%s).', vdRemove: 'Quitar', vdLoading: 'Abriendo…', vdHint: 'OK: reproducir / pausa · Izquierda / Derecha: 10 s · Atrás: lista'
        },
        ar: {
            receiver: 'المستقبِل', sendtv: 'إرسال إلى التلفاز', photos: 'MyPhotos', notes: 'MyNotes', videos: 'MyVideos',
            rxTitle: 'الاستقبال من هاتف', rxHelp: 'على هاتفك، شارك صورة أو فيديو أو أغنية أو رابطاً أو نصاً واختر «إرسال إلى التلفاز (My PC)» (تطبيق My PC لأندرويد). يجد هذا التلفاز الهاتف بنفسه على شبكة منزلك.',
            rxLooking: 'جارٍ البحث عن الهواتف على شبكتك… %n%', rxNoPhone: 'لم يُعثر على أي هاتف بعد. يجب أن يكون الهاتف على نفس شبكة Wi-Fi مع التلفاز، وتطبيق My PC مفتوح.',
            rxReady: 'جاهز لـ %s', rxNoNet: 'هذا التلفاز غير متصل بأي شبكة. وصّله أولاً بشبكة Wi-Fi أو بالراوتر.', rxAddr: 'هذا التلفاز: %s',
            rxScan: 'البحث مرة أخرى', rxManual: 'كتابة عنوان الهاتف', rxManualHint: 'العنوان الظاهر على الهاتف، مثل 192.168.1.23', rxBadAddr: 'لا يجيب أي هاتف My PC على %s.',
            rxStop: 'إيقاف الاستقبال', rxStart: 'بدء الاستقبال', rxOn: 'الاستقبال يعمل: ما يرسله هاتفك يُفتح هنا حتى لو أغلقت هذه النافذة (حتى تفتح لعبة أو تطبيقاً).',
            rxOff: 'الاستقبال متوقف.', rxGot: 'من %s', rxHistory: 'ما تم استقباله', rxNone: 'لم يُستقبل شيء بعد.', rxOpen: 'فتح',
            rxCant: 'لا يستطيع My PC فتح هذا النوع من الملفات: %s', rxFail: 'تعذر جلبه من الهاتف.', rxPhoneGone: 'غادر %s',
            rxPhoto: 'صورة', rxVideo: 'فيديو', rxSong: 'أغنية', rxLink: 'رابط', rxText: 'نص', rxFile: 'ملف',
            rxTray: 'المستقبِل يعمل: هذا التلفاز يستقبل ما ترسله هواتفك',
            stPick: 'إرسال إلى %s', stAlways: 'الإرسال دائماً إلى هذا التلفاز', stAuto: 'يُرسل تلقائياً إلى %s', stForget: 'إيقاف الإرسال التلقائي',
            stState_wait: 'في الانتظار', stState_sent: 'جارٍ الإرسال…', stState_taken: 'فُتح على التلفاز', stState_failed: 'تعذر على التلفاز فتحه',
            stAddr: 'هذا الهاتف: %s', stNoWifi: 'هذا الهاتف غير متصل بأي شبكة Wi-Fi.', stTypeText: 'إرسال نص أو رابط', stClear: 'مسح القائمة',
            stRemove: 'إزالة', stNone: 'لا شيء للإرسال. في أي تطبيق، شارك صورة أو فيديو أو أغنية أو رابطاً أو نصاً واختر «إرسال إلى التلفاز (My PC)».',
            stOld: 'حدّث تطبيق My PC على هذا الهاتف للإرسال إلى التلفاز.', stTvs: 'أجهزة تلفاز المستقبِل فيها مفتوح', stItems: 'ما تمت مشاركته', stOff: 'تعذر على الهاتف فتح منفذه: أغلق My PC وافتحه من جديد.',
            ntNew: 'ملاحظة جديدة', ntNone: 'لا توجد ملاحظات بعد. اكتب واحدة، أو أرسل نصاً من هاتفك (افتح المستقبِل).', ntDelete: 'حذف', ntDelSure: 'اضغط OK مرة أخرى للحذف',
            ntEdit: 'تعديل', ntOpenLink: 'فتح الرابط', ntFrom: 'من %s', ntDeleted: 'تم حذف الملاحظة', ntMine: 'كُتبت هنا',
            phNone: 'لا توجد صور بعد. افتح المستقبِل على التلفاز، ثم شارك الصور من الهاتف عبر «إرسال إلى التلفاز (My PC)».', phDelete: 'حذف', phDelSure: 'اضغط OK مرة أخرى للحذف',
            phCount: '%n صورة', phPrev: 'السابقة', phNext: 'التالية', phTurn: 'تدوير', phSlide: 'عرض شرائح', phHint: 'يسار / يمين: صور أخرى · OK: الأزرار · رجوع: كل الصور',
            phDeleted: 'تم حذف الصورة', phNoSave: 'تعذر حفظ الصورة على التلفاز.',
            vdNone: 'لا توجد فيديوهات بعد. افتح المستقبِل على التلفاز، ثم شارك فيديو من الهاتف: يُشغَّل مباشرة من الهاتف، فأبقِ My PC مفتوحاً عليه.',
            vdPlay: 'تشغيل', vdPause: 'إيقاف مؤقت', vdBack10: '−10 ث', vdFwd10: '+10 ث', vdGone: 'لم يعد الهاتف يشارك هذا الفيديو: أرسله من جديد.',
            vdError: 'تعذر تشغيل الفيديو (%s).', vdRemove: 'إزالة', vdLoading: 'جارٍ الفتح…', vdHint: 'OK: تشغيل / إيقاف مؤقت · يسار / يمين: 10 ث · رجوع: القائمة'
        }
    });
    // over the internet (owner request 2026-11-13 (2)): Listen on Automatic / This Wi-Fi / Internet, the TV's code
    I18n.add({
        en: {
            rxPrivacy: 'On this Wi-Fi everything goes straight from your phone to this TV: nothing goes through the internet. Over the internet, what you send waits in Google\'s database (Firestore) until the TV takes it (at most a day) and is then deleted; anyone who knows this TV\'s code can send to it (New code changes it). Videos, songs and big files still come only over the same Wi-Fi.', rxHelpNet: 'On your phone, open My PC > Send to TV, add this TV with its code (or scan the QR code), then share a photo, link or text. The phone can be anywhere with internet.', rxNetOn: 'Listening over the internet. Phones send to this TV with its code.', rxNetFail: 'Google\'s database does not answer. Pick This Wi-Fi, or check the internet.', rxNetStart: 'Connecting to the internet…', rxCheck: 'Check now', rxVia: 'Listen on', rxViaAuto: 'Automatic', rxViaLan: 'This Wi-Fi', rxViaNet: 'Internet', rxCode: 'This TV\'s code', rxCodeHelp: 'On the phone: My PC > Send to TV > Add a TV by its code, or scan this QR code with the phone.', rxNewCode: 'New code', rxNeedWifi: '%s is too big for the internet: the phone and the TV must be on the same Wi-Fi.', stHelp: 'On the TV, open Receiver (on the My PC desktop). On the same Wi-Fi it finds this phone by itself; anywhere else, add the TV with the code shown on its Receiver.', stHelpWeb: 'Add a TV with the code shown on its Receiver, then send it texts, links and photos over the internet. For videos, songs and files, use the My PC app for Android.', stWaitTv: 'No TV yet: open Receiver on the TV, or add one with its code.', stPhone: 'Phone', stNoNet: 'No internet: the TV could not be checked.', stBadCode: 'No TV has this code. Check it on the TV\'s Receiver.', stAdded: '%s added', stWifi: 'Wi-Fi', stNet: 'Internet', stNetOn: 'Receiver on', stNetOff: 'Receiver off: it gets what you send when it opens (within a day)', stNetAsk: 'Checking…', stForgetTv: 'Remove', stAddCode: 'Add a TV by its code', stCodeHint: 'The 10 letters and numbers shown on the TV\'s Receiver', stScan: 'Scan the TV\'s QR code', stPhotos: 'Send photos', stState_up: 'Waiting for the TV'
        },
        fr: {
            rxPrivacy: 'Sur ce Wi-Fi, tout va directement de votre téléphone à cette TV : rien ne passe par internet. Par internet, ce que vous envoyez attend dans la base de données de Google (Firestore) que la TV le prenne (un jour au plus), puis est supprimé ; quiconque connaît le code de cette TV peut lui envoyer (Nouveau code le change). Vidéos, musiques et gros fichiers passent seulement par le même Wi-Fi.', rxHelpNet: 'Sur votre téléphone, ouvrez My PC > Envoyer à la TV, ajoutez cette TV avec son code (ou scannez le code QR), puis partagez une photo, un lien ou un texte. Le téléphone peut être n’importe où avec internet.', rxNetOn: 'À l’écoute par internet. Les téléphones envoient à cette TV avec son code.', rxNetFail: 'La base de données de Google ne répond pas. Choisissez Ce Wi-Fi, ou vérifiez internet.', rxNetStart: 'Connexion à internet…', rxCheck: 'Vérifier maintenant', rxVia: 'Écouter sur', rxViaAuto: 'Automatique', rxViaLan: 'Ce Wi-Fi', rxViaNet: 'Internet', rxCode: 'Code de cette TV', rxCodeHelp: 'Sur le téléphone : My PC > Envoyer à la TV > Ajouter une TV par son code, ou scannez ce code QR avec le téléphone.', rxNewCode: 'Nouveau code', rxNeedWifi: '%s est trop gros pour internet : le téléphone et la TV doivent être sur le même Wi-Fi.', stHelp: 'Sur la TV, ouvrez Récepteur (sur le bureau My PC). Sur le même Wi-Fi, elle trouve ce téléphone toute seule ; ailleurs, ajoutez la TV avec le code affiché sur son Récepteur.', stHelpWeb: 'Ajoutez une TV avec le code affiché sur son Récepteur, puis envoyez-lui textes, liens et photos par internet. Pour les vidéos, musiques et fichiers, utilisez l’application My PC pour Android.', stWaitTv: 'Aucune TV : ouvrez Récepteur sur la TV, ou ajoutez-en une avec son code.', stPhone: 'Téléphone', stNoNet: 'Pas d’internet : la TV n’a pas pu être vérifiée.', stBadCode: 'Aucune TV n’a ce code. Vérifiez-le sur le Récepteur de la TV.', stAdded: '%s ajoutée', stWifi: 'Wi-Fi', stNet: 'Internet', stNetOn: 'Récepteur ouvert', stNetOff: 'Récepteur fermé : elle reçoit vos envois à son ouverture (dans la journée)', stNetAsk: 'Vérification…', stForgetTv: 'Retirer', stAddCode: 'Ajouter une TV par son code', stCodeHint: 'Les 10 lettres et chiffres affichés sur le Récepteur de la TV', stScan: 'Scanner le code QR de la TV', stPhotos: 'Envoyer des photos', stState_up: 'En attente de la TV'
        },
        es: {
            rxPrivacy: 'En este Wi-Fi todo va directamente de tu móvil a esta TV: nada pasa por internet. Por internet, lo que envías espera en la base de datos de Google (Firestore) hasta que la TV lo recoge (un día como mucho) y luego se borra; quien conozca el código de esta TV puede enviarle (Nuevo código lo cambia). Vídeos, canciones y archivos grandes solo llegan por el mismo Wi-Fi.', rxHelpNet: 'En tu móvil, abre My PC > Enviar a la TV, añade esta TV con su código (o escanea el código QR) y comparte una foto, un enlace o un texto. El móvil puede estar en cualquier sitio con internet.', rxNetOn: 'Escuchando por internet. Los móviles envían a esta TV con su código.', rxNetFail: 'La base de datos de Google no responde. Elige Este Wi-Fi o revisa internet.', rxNetStart: 'Conectando a internet…', rxCheck: 'Comprobar ahora', rxVia: 'Escuchar en', rxViaAuto: 'Automático', rxViaLan: 'Este Wi-Fi', rxViaNet: 'Internet', rxCode: 'Código de esta TV', rxCodeHelp: 'En el móvil: My PC > Enviar a la TV > Añadir una TV por su código, o escanea este código QR con el móvil.', rxNewCode: 'Nuevo código', rxNeedWifi: '%s es demasiado grande para internet: el móvil y la TV deben estar en el mismo Wi-Fi.', stHelp: 'En la TV, abre Receptor (en el escritorio de My PC). En el mismo Wi-Fi encuentra este móvil sola; en otro sitio, añade la TV con el código que muestra su Receptor.', stHelpWeb: 'Añade una TV con el código que muestra su Receptor y envíale textos, enlaces y fotos por internet. Para vídeos, canciones y archivos, usa la app My PC para Android.', stWaitTv: 'Ninguna TV aún: abre Receptor en la TV o añade una con su código.', stPhone: 'Móvil', stNoNet: 'Sin internet: no se pudo comprobar la TV.', stBadCode: 'Ninguna TV tiene este código. Compruébalo en el Receptor de la TV.', stAdded: '%s añadida', stWifi: 'Wi-Fi', stNet: 'Internet', stNetOn: 'Receptor abierto', stNetOff: 'Receptor cerrado: recibe lo que envíes al abrirlo (en un día)', stNetAsk: 'Comprobando…', stForgetTv: 'Quitar', stAddCode: 'Añadir una TV por su código', stCodeHint: 'Las 10 letras y números que muestra el Receptor de la TV', stScan: 'Escanear el código QR de la TV', stPhotos: 'Enviar fotos', stState_up: 'Esperando a la TV'
        },
        ar: {
            rxPrivacy: 'على شبكة Wi-Fi هذه ينتقل كل شيء مباشرة من هاتفك إلى هذا التلفاز: لا شيء يمر عبر الإنترنت. عبر الإنترنت، ينتظر ما ترسله في قاعدة بيانات Google (Firestore) حتى يأخذه التلفاز (يوم واحد على الأكثر) ثم يُحذف؛ يمكن لأي شخص يعرف رمز هذا التلفاز أن يرسل إليه (رمز جديد يغيّره). الفيديوهات والأغاني والملفات الكبيرة تصل فقط عبر شبكة Wi-Fi نفسها.', rxHelpNet: 'على هاتفك، افتح My PC > إرسال إلى التلفاز، وأضف هذا التلفاز برمزه (أو امسح رمز QR)، ثم شارك صورة أو رابطًا أو نصًا. يمكن أن يكون الهاتف في أي مكان فيه إنترنت.', rxNetOn: 'الاستماع عبر الإنترنت. ترسل الهواتف إلى هذا التلفاز برمزه.', rxNetFail: 'قاعدة بيانات Google لا تجيب. اختر شبكة Wi-Fi هذه، أو تحقق من الإنترنت.', rxNetStart: 'جارٍ الاتصال بالإنترنت…', rxCheck: 'تحقق الآن', rxVia: 'الاستماع على', rxViaAuto: 'تلقائي', rxViaLan: 'شبكة Wi-Fi هذه', rxViaNet: 'الإنترنت', rxCode: 'رمز هذا التلفاز', rxCodeHelp: 'على الهاتف: My PC > إرسال إلى التلفاز > إضافة تلفاز برمزه، أو امسح رمز QR هذا بالهاتف.', rxNewCode: 'رمز جديد', rxNeedWifi: '%s كبير جدًا للإنترنت: يجب أن يكون الهاتف والتلفاز على شبكة Wi-Fi نفسها.', stHelp: 'على التلفاز، افتح المستقبِل (على سطح مكتب My PC). على شبكة Wi-Fi نفسها يجد هذا الهاتف بنفسه؛ وفي أي مكان آخر، أضف التلفاز بالرمز الظاهر على مستقبِله.', stHelpWeb: 'أضف تلفازًا بالرمز الظاهر على مستقبِله، ثم أرسل إليه نصوصًا وروابط وصورًا عبر الإنترنت. للفيديوهات والأغاني والملفات، استخدم تطبيق My PC لنظام Android.', stWaitTv: 'لا يوجد تلفاز بعد: افتح المستقبِل على التلفاز، أو أضف تلفازًا برمزه.', stPhone: 'هاتف', stNoNet: 'لا يوجد إنترنت: تعذر التحقق من التلفاز.', stBadCode: 'لا يوجد تلفاز بهذا الرمز. تحقق منه على مستقبِل التلفاز.', stAdded: 'تمت إضافة %s', stWifi: 'Wi-Fi', stNet: 'الإنترنت', stNetOn: 'المستقبِل مفتوح', stNetOff: 'المستقبِل مغلق: سيتلقى ما ترسله عند فتحه (خلال يوم)', stNetAsk: 'جارٍ التحقق…', stForgetTv: 'إزالة', stAddCode: 'إضافة تلفاز برمزه', stCodeHint: 'الأحرف والأرقام العشرة الظاهرة على مستقبِل التلفاز', stScan: 'مسح رمز QR الخاص بالتلفاز', stPhotos: 'إرسال صور', stState_up: 'في انتظار التلفاز'
        }
    });
})();
