/* Strings of speech to text (js/core/stt.js, Control Panel > Speech to text, the "Listening" card). Keep sttPrivacy true. */
(function () {
    'use strict';
    var S = {
        en: {
            sysStt: 'Speech to text', sttTitle: 'Speech to text', sttOn: 'Speech to text',
            sttOnDesc: 'Apps and games that listen get what you say as text: press their talk button (A in a chat) or the microphone button on your phone\'s pad. Off: they show the keyboard instead.',
            sttLang: 'Language you speak', sttLangAuto: 'Same as My PC (%s)',
            sttEngine: 'Write it down with', sttEngineDesc: 'Automatic: the phone\'s (or computer\'s) own speech recognition when it has one, else My PC\'s AI service. The AI service: always My PC\'s AI service.',
            sttEngine_auto: 'Automatic', sttEngine_ai: 'The AI service',
            sttNow: 'Now', sttReady_phone: 'Ready: %p writes down what you say', sttReady_phoneai: 'Ready: %p records, %s writes it down',
            sttReady_device: 'Ready: this computer\'s own speech recognition', sttReady_deviceai: 'Ready: this device\'s microphone, written down by %s',
            sttWhy_off: 'Turned off', sttWhy_nomic: 'Connect a phone in the Game controller\'s Buttons mode: it is the microphone (the remote\'s is kept for Bixby).',
            sttWhy_noservice: 'No AI service of My PC writes speech down: add Gemini, OpenAI or Groq in the App Store Manager (AI services).',
            sttTry: 'Try it', sttTryDesc: 'Listens once and shows what it heard',
            sttHow: 'In an app: press its talk button or the microphone button on your phone\'s pad, speak, then stop for a moment. The words go to the app. A card shows while My PC listens.',
            sttListening: 'Listening…', sttSpeak: 'Speak now', sttSpeakPhone: 'Speak into %s', sttPhone: 'your phone', sttWorking: 'Writing it down…', sttWorkingText: 'One moment', sttHeard: 'You said',
            sttErr_off: 'Speech to text is off (Control Panel > Speech to text).', sttErr_busy: 'My PC is already listening.', sttErr_nomic: 'No microphone: connect a phone in the Game controller\'s Buttons mode.',
            sttErr_noservice: 'No AI service writes speech down (App Store Manager > AI services).', sttErr_denied: 'The microphone was not allowed.', sttErr_nothing: 'Nothing was heard. Try again a bit louder.',
            sttErr_network: 'The speech service could not be reached.', sttErr_failed: 'Speech to text did not work.', sttErr_cancelled: 'Stopped.',
            sttPrivacy: 'Speech to text (only when you turn it on and an app listens): what you say is recorded by your phone and written down by the phone\'s own speech service, or sent once to My PC\'s AI service (App Store Manager > AI services). Only the words go to the app; the sound is not kept.'
        },
        fr: {
            sysStt: 'Reconnaissance vocale', sttTitle: 'Reconnaissance vocale', sttOn: 'Reconnaissance vocale',
            sttOnDesc: 'Les applications et jeux qui écoutent reçoivent ce que vous dites en texte : appuyez sur leur bouton pour parler (A dans un chat) ou sur le bouton micro de la manette du téléphone. Désactivée : ils affichent le clavier.',
            sttLang: 'Langue parlée', sttLangAuto: 'Comme My PC (%s)',
            sttEngine: 'Transcrire avec', sttEngineDesc: 'Automatique : la reconnaissance vocale du téléphone (ou de l’ordinateur) quand il en a une, sinon le service d’IA de My PC. Le service d’IA : toujours le service d’IA de My PC.',
            sttEngine_auto: 'Automatique', sttEngine_ai: 'Le service d’IA',
            sttNow: 'Maintenant', sttReady_phone: 'Prête : %p transcrit ce que vous dites', sttReady_phoneai: 'Prête : %p enregistre, %s transcrit',
            sttReady_device: 'Prête : la reconnaissance vocale de cet ordinateur', sttReady_deviceai: 'Prête : le micro de cet appareil, transcrit par %s',
            sttWhy_off: 'Désactivée', sttWhy_nomic: 'Connectez un téléphone en mode Boutons de la Manette : c’est le micro (celui de la télécommande est réservé à Bixby).',
            sttWhy_noservice: 'Aucun service d’IA de My PC ne transcrit la parole : ajoutez Gemini, OpenAI ou Groq dans le gestionnaire de l’App Store (Services d’IA).',
            sttTry: 'Essayer', sttTryDesc: 'Écoute une fois et affiche ce qui a été entendu',
            sttHow: 'Dans une application : appuyez sur son bouton pour parler ou sur le bouton micro de la manette du téléphone, parlez, puis faites une petite pause. Les mots vont à l’application. Une carte s’affiche pendant l’écoute.',
            sttListening: 'Écoute…', sttSpeak: 'Parlez maintenant', sttSpeakPhone: 'Parlez dans %s', sttPhone: 'votre téléphone', sttWorking: 'Transcription…', sttWorkingText: 'Un instant', sttHeard: 'Vous avez dit',
            sttErr_off: 'La reconnaissance vocale est désactivée (Panneau de configuration > Reconnaissance vocale).', sttErr_busy: 'My PC écoute déjà.', sttErr_nomic: 'Pas de micro : connectez un téléphone en mode Boutons de la Manette.',
            sttErr_noservice: 'Aucun service d’IA ne transcrit la parole (gestionnaire de l’App Store > Services d’IA).', sttErr_denied: 'Le micro n’a pas été autorisé.', sttErr_nothing: 'Rien n’a été entendu. Réessayez un peu plus fort.',
            sttErr_network: 'Le service vocal est injoignable.', sttErr_failed: 'La reconnaissance vocale n’a pas marché.', sttErr_cancelled: 'Arrêté.',
            sttPrivacy: 'Reconnaissance vocale (seulement si vous l’activez et qu’une application écoute) : ce que vous dites est enregistré par votre téléphone et transcrit par son propre service vocal, ou envoyé une fois au service d’IA de My PC (gestionnaire de l’App Store > Services d’IA). Seuls les mots vont à l’application ; le son n’est pas gardé.'
        },
        es: {
            sysStt: 'Voz a texto', sttTitle: 'Voz a texto', sttOn: 'Voz a texto',
            sttOnDesc: 'Las aplicaciones y juegos que escuchan reciben lo que dices como texto: pulsa su botón para hablar (A en un chat) o el botón de micrófono del mando del teléfono. Desactivado: muestran el teclado.',
            sttLang: 'Idioma que hablas', sttLangAuto: 'Como My PC (%s)',
            sttEngine: 'Transcribir con', sttEngineDesc: 'Automático: el reconocimiento de voz del teléfono (o del ordenador) cuando lo tiene, si no el servicio de IA de My PC. El servicio de IA: siempre el servicio de IA de My PC.',
            sttEngine_auto: 'Automático', sttEngine_ai: 'El servicio de IA',
            sttNow: 'Ahora', sttReady_phone: 'Listo: %p transcribe lo que dices', sttReady_phoneai: 'Listo: %p graba, %s lo transcribe',
            sttReady_device: 'Listo: el reconocimiento de voz de este ordenador', sttReady_deviceai: 'Listo: el micrófono de este dispositivo, transcrito por %s',
            sttWhy_off: 'Desactivado', sttWhy_nomic: 'Conecta un teléfono en el modo Botones del Mando: es el micrófono (el del mando a distancia es para Bixby).',
            sttWhy_noservice: 'Ningún servicio de IA de My PC transcribe la voz: añade Gemini, OpenAI o Groq en el gestor de la App Store (Servicios de IA).',
            sttTry: 'Probar', sttTryDesc: 'Escucha una vez y muestra lo que oyó',
            sttHow: 'En una aplicación: pulsa su botón para hablar o el botón de micrófono del mando del teléfono, habla y haz una pequeña pausa. Las palabras van a la aplicación. Una tarjeta se ve mientras My PC escucha.',
            sttListening: 'Escuchando…', sttSpeak: 'Habla ahora', sttSpeakPhone: 'Habla en %s', sttPhone: 'tu teléfono', sttWorking: 'Transcribiendo…', sttWorkingText: 'Un momento', sttHeard: 'Dijiste',
            sttErr_off: 'Voz a texto está desactivado (Panel de control > Voz a texto).', sttErr_busy: 'My PC ya está escuchando.', sttErr_nomic: 'Sin micrófono: conecta un teléfono en el modo Botones del Mando.',
            sttErr_noservice: 'Ningún servicio de IA transcribe la voz (gestor de la App Store > Servicios de IA).', sttErr_denied: 'No se permitió el micrófono.', sttErr_nothing: 'No se oyó nada. Inténtalo un poco más fuerte.',
            sttErr_network: 'No se pudo contactar con el servicio de voz.', sttErr_failed: 'Voz a texto no funcionó.', sttErr_cancelled: 'Detenido.',
            sttPrivacy: 'Voz a texto (solo si lo activas y una aplicación escucha): lo que dices lo graba tu teléfono y lo transcribe su propio servicio de voz, o se envía una vez al servicio de IA de My PC (gestor de la App Store > Servicios de IA). Solo las palabras van a la aplicación; el sonido no se guarda.'
        },
        ar: {
            sysStt: 'تحويل الكلام إلى نص', sttTitle: 'تحويل الكلام إلى نص', sttOn: 'تحويل الكلام إلى نص',
            sttOnDesc: 'التطبيقات والألعاب التي تستمع تتلقى ما تقوله نصاً: اضغط زر التحدث فيها (A في الدردشة) أو زر الميكروفون في ذراع الهاتف. عند الإيقاف: تعرض لوحة المفاتيح بدلاً من ذلك.',
            sttLang: 'اللغة التي تتحدثها', sttLangAuto: 'مثل My PC (%s)',
            sttEngine: 'التحويل بواسطة', sttEngineDesc: 'تلقائي: التعرف على الكلام في الهاتف (أو الكمبيوتر) إن وُجد، وإلا خدمة الذكاء الاصطناعي في My PC. خدمة الذكاء الاصطناعي: دائماً خدمة My PC.',
            sttEngine_auto: 'تلقائي', sttEngine_ai: 'خدمة الذكاء الاصطناعي',
            sttNow: 'الآن', sttReady_phone: 'جاهز: %p يكتب ما تقوله', sttReady_phoneai: 'جاهز: %p يسجّل و%s يكتبه',
            sttReady_device: 'جاهز: التعرف على الكلام في هذا الكمبيوتر', sttReady_deviceai: 'جاهز: ميكروفون هذا الجهاز، يكتبه %s',
            sttWhy_off: 'متوقف', sttWhy_nomic: 'وصّل هاتفاً في وضع الأزرار لذراع التحكم: هو الميكروفون (ميكروفون جهاز التحكم محجوز لـ Bixby).',
            sttWhy_noservice: 'لا توجد خدمة ذكاء اصطناعي في My PC تكتب الكلام: أضف Gemini أو OpenAI أو Groq في مدير متجر التطبيقات (خدمات الذكاء الاصطناعي).',
            sttTry: 'جرّب', sttTryDesc: 'يستمع مرة واحدة ويعرض ما سمعه',
            sttHow: 'في تطبيق: اضغط زر التحدث فيه أو زر الميكروفون في ذراع الهاتف، تكلّم ثم توقف لحظة. تذهب الكلمات إلى التطبيق. تظهر بطاقة أثناء الاستماع.',
            sttListening: 'جارٍ الاستماع…', sttSpeak: 'تكلّم الآن', sttSpeakPhone: 'تكلّم في %s', sttPhone: 'هاتفك', sttWorking: 'جارٍ الكتابة…', sttWorkingText: 'لحظة', sttHeard: 'قلت',
            sttErr_off: 'تحويل الكلام إلى نص متوقف (لوحة التحكم > تحويل الكلام إلى نص).', sttErr_busy: 'My PC يستمع بالفعل.', sttErr_nomic: 'لا يوجد ميكروفون: وصّل هاتفاً في وضع الأزرار لذراع التحكم.',
            sttErr_noservice: 'لا توجد خدمة ذكاء اصطناعي تكتب الكلام (مدير متجر التطبيقات > خدمات الذكاء الاصطناعي).', sttErr_denied: 'لم يُسمح بالميكروفون.', sttErr_nothing: 'لم يُسمع شيء. حاول بصوت أعلى قليلاً.',
            sttErr_network: 'تعذر الوصول إلى خدمة الكلام.', sttErr_failed: 'لم ينجح تحويل الكلام إلى نص.', sttErr_cancelled: 'توقف.',
            sttPrivacy: 'تحويل الكلام إلى نص (فقط عند تشغيله واستماع تطبيق): ما تقوله يسجله هاتفك ويكتبه نظام الكلام في الهاتف، أو يُرسل مرة واحدة إلى خدمة الذكاء الاصطناعي في My PC (مدير متجر التطبيقات > خدمات الذكاء الاصطناعي). تذهب الكلمات فقط إلى التطبيق؛ ولا يُحتفظ بالصوت.'
        }
    };
    // error codes with a dash ('no-mic', 'no-service') read the key without it
    for (var l in S) {
        var p = I18n.raw(l, 'privacyText');
        if (p && p.length !== undefined) S[l].privacyText = p.concat([S[l].sttPrivacy]);
    }
    I18n.add(S);
})();
