/* UI strings (en, fr, es, ar). Markup uses data-i18n / data-i18n-aria-label; code uses I18n.t(). */
var I18n = (function () {
    'use strict';

    var LANGS = ['en', 'fr', 'es', 'ar'];
    var NAMES = { en: 'English', fr: 'Français', es: 'Español', ar: 'العربية' };

    var S = {
        en: {
            netOff: 'No network connection. Your games keep working offline.', netOn: 'Network connected',
            scores: 'Top scores', newHigh: 'New high score!', rank: 'Rank', entryHint: 'Up and down: change letter. Left and right: move. OK: save.', save: 'Save', letter: 'Letter', of: 'of', noScores: 'No scores yet', player: 'Player', points: 'points',
            appTitle: 'Arcade', games: 'Games', settings: 'Settings', play: 'Play',
            badgeNew: 'New', badgeUpdated: 'Updated', lastPlayed: 'Last played',
            language: 'Language', musicVol: 'Music volume', sfxVol: 'Sound effects volume',
            graphics: 'Graphics quality', gfxAuto: 'Auto', gfxLow: 'Low', gfxMid: 'Medium', gfxHigh: 'High',
            controls: 'Controller help', resetProgress: 'Reset progress', privacy: 'Privacy policy',
            about: 'About', close: 'Close', back: 'Back',
            exitTitle: 'Exit Arcade?', exitText: 'Do you want to close the app?', yes: 'Yes', no: 'No',
            resetTitle: 'Reset progress?', resetText: 'All saved progress and high scores of this profile will be deleted.',
            profiles: 'Profiles', profile: 'Profile', switchProfile: 'Press OK to switch or create a profile', active: 'Playing now', switchHint: 'Press OK to play as this profile',
            profilesHint: 'Each profile keeps its own progress and scores.', newProfile: 'New profile', renameProfile: 'Rename', deleteProfile: 'Delete profile',
            deleteTitle: 'Delete profile?', deleteText: 'All progress and scores of %s will be deleted.', hello: 'Hello', space: 'Space', erase: 'Delete letter', cancel: 'Cancel',
            namerHint: 'Choose letters with the arrows and OK, then choose Save.',
            resetDone: 'Progress reset',
            paused: 'Paused', resume: 'Resume', quitToMenu: 'Quit to menu',
            loading: 'Loading', loadError: 'The game could not be loaded.', retry: 'Retry', backToMenu: 'Back to menu',
            padOn: 'Gamepad connected', padOff: 'Gamepad disconnected. Game paused.',
            inputRemote: 'Remote', inputPad: 'Gamepad', inputKeys: 'Keyboard',
            version: 'Version', build: 'Build', online: 'Online update', onlineYes: 'Yes (hosted copy)',
            onlineNo: 'No (bundled copy)', device: 'Device profile',
            adjustHint: 'Use left and right to change',
            controlsText: [
                'Remote: arrows move, OK jumps or confirms, hold OK to jump higher, Back pauses.',
                'Red key: run on or off (for remote-only play). Play/Pause key: pause.',
                'Gamepad: D-pad or left stick to move, A to jump, B or X to run or fire, Start or Select to pause.',
                'Keyboard: arrows, Space or Z to jump, Shift or X to run, Esc to pause.',
                'Super Jumper for two: open the pause menu, choose Two players, then player 2 presses OK or A on their own controller (another gamepad, the remote, or W A S D + F on a keyboard).'
            ],
            privacyText: [
                'Arcade does not collect, store or share any personal data.',
                'Game progress and settings are saved only on this TV and can be deleted with Reset progress.',
                'At start-up the app downloads update files from imad-os.github.io. No identifier is sent.',
                'There are no ads, accounts or in-app purchases.'
            ]
        },
        fr: {
            netOff: 'Pas de connexion réseau. Vos jeux fonctionnent hors ligne.', netOn: 'Réseau connecté',
            scores: 'Meilleurs scores', newHigh: 'Nouveau record !', rank: 'Rang', entryHint: 'Haut et bas : changer la lettre. Gauche et droite : se déplacer. OK : enregistrer.', save: 'Enregistrer', letter: 'Lettre', of: 'sur', noScores: 'Aucun score', player: 'Joueur', points: 'points',
            appTitle: 'Arcade', games: 'Jeux', settings: 'Paramètres', play: 'Jouer',
            badgeNew: 'Nouveau', badgeUpdated: 'Mis à jour', lastPlayed: 'Dernier joué',
            language: 'Langue', musicVol: 'Volume de la musique', sfxVol: 'Volume des effets',
            graphics: 'Qualité graphique', gfxAuto: 'Auto', gfxLow: 'Basse', gfxMid: 'Moyenne', gfxHigh: 'Haute',
            controls: 'Aide des commandes', resetProgress: 'Réinitialiser la progression', privacy: 'Politique de confidentialité',
            about: 'À propos', close: 'Fermer', back: 'Retour',
            exitTitle: 'Quitter Arcade ?', exitText: "Voulez-vous fermer l'application ?", yes: 'Oui', no: 'Non',
            resetTitle: 'Réinitialiser ?', resetText: 'Toute la progression et les meilleurs scores de ce profil seront supprimés.',
            profiles: 'Profils', profile: 'Profil', switchProfile: 'Appuyez sur OK pour changer ou créer un profil', active: 'En jeu', switchHint: 'Appuyez sur OK pour jouer avec ce profil',
            profilesHint: 'Chaque profil garde sa progression et ses scores.', newProfile: 'Nouveau profil', renameProfile: 'Renommer', deleteProfile: 'Supprimer le profil',
            deleteTitle: 'Supprimer le profil ?', deleteText: 'Toute la progression et les scores de %s seront supprimés.', hello: 'Bonjour', space: 'Espace', erase: 'Effacer', cancel: 'Annuler',
            namerHint: 'Choisissez les lettres avec les flèches et OK, puis Enregistrer.',
            resetDone: 'Progression réinitialisée',
            paused: 'Pause', resume: 'Reprendre', quitToMenu: 'Retour au menu',
            loading: 'Chargement', loadError: "Le jeu n'a pas pu être chargé.", retry: 'Réessayer', backToMenu: 'Retour au menu',
            padOn: 'Manette connectée', padOff: 'Manette déconnectée. Jeu en pause.',
            inputRemote: 'Télécommande', inputPad: 'Manette', inputKeys: 'Clavier',
            version: 'Version', build: 'Build', online: 'Mise à jour en ligne', onlineYes: 'Oui (copie en ligne)',
            onlineNo: 'Non (copie intégrée)', device: "Profil de l'appareil",
            adjustHint: 'Utilisez gauche et droite pour modifier',
            controlsText: [
                'Télécommande : flèches pour bouger, OK pour sauter ou valider, maintenir OK pour sauter plus haut, Retour pour la pause.',
                'Touche rouge : course activée ou non. Touche Lecture/Pause : pause.',
                'Manette : croix ou stick gauche pour bouger, A pour sauter, B ou X pour courir ou tirer, Start ou Select pour la pause.',
                'Clavier : flèches, Espace ou Z pour sauter, Maj ou X pour courir, Échap pour la pause.',
                'Super Jumper à deux : ouvrez le menu pause, choisissez Deux joueurs, puis le joueur 2 appuie sur OK ou A sur sa propre manette (une autre manette, la télécommande, ou W A S D + F sur un clavier).'
            ],
            privacyText: [
                "Arcade ne collecte, ne stocke et ne partage aucune donnée personnelle.",
                'La progression et les réglages sont enregistrés uniquement sur ce téléviseur.',
                "Au démarrage, l'application télécharge des fichiers de mise à jour depuis imad-os.github.io. Aucun identifiant n'est envoyé.",
                "Pas de publicité, de compte ni d'achat intégré."
            ]
        },
        es: {
            netOff: 'Sin conexión de red. Tus juegos siguen funcionando sin conexión.', netOn: 'Red conectada',
            scores: 'Mejores puntuaciones', newHigh: '¡Nuevo récord!', rank: 'Puesto', entryHint: 'Arriba y abajo: cambiar letra. Izquierda y derecha: mover. OK: guardar.', save: 'Guardar', letter: 'Letra', of: 'de', noScores: 'Sin puntuaciones', player: 'Jugador', points: 'puntos',
            appTitle: 'Arcade', games: 'Juegos', settings: 'Ajustes', play: 'Jugar',
            badgeNew: 'Nuevo', badgeUpdated: 'Actualizado', lastPlayed: 'Último jugado',
            language: 'Idioma', musicVol: 'Volumen de la música', sfxVol: 'Volumen de efectos',
            graphics: 'Calidad gráfica', gfxAuto: 'Auto', gfxLow: 'Baja', gfxMid: 'Media', gfxHigh: 'Alta',
            controls: 'Ayuda de controles', resetProgress: 'Borrar progreso', privacy: 'Política de privacidad',
            about: 'Acerca de', close: 'Cerrar', back: 'Atrás',
            exitTitle: '¿Salir de Arcade?', exitText: '¿Quieres cerrar la aplicación?', yes: 'Sí', no: 'No',
            resetTitle: '¿Borrar progreso?', resetText: 'Se eliminarán todo el progreso y las mejores puntuaciones de este perfil.',
            profiles: 'Perfiles', profile: 'Perfil', switchProfile: 'Pulsa OK para cambiar o crear un perfil', active: 'Jugando', switchHint: 'Pulsa OK para jugar con este perfil',
            profilesHint: 'Cada perfil guarda su propio progreso y puntuaciones.', newProfile: 'Nuevo perfil', renameProfile: 'Cambiar nombre', deleteProfile: 'Borrar perfil',
            deleteTitle: '¿Borrar perfil?', deleteText: 'Se borrarán todo el progreso y las puntuaciones de %s.', hello: 'Hola', space: 'Espacio', erase: 'Borrar letra', cancel: 'Cancelar',
            namerHint: 'Elige letras con las flechas y OK, después Guardar.',
            resetDone: 'Progreso borrado',
            paused: 'Pausa', resume: 'Continuar', quitToMenu: 'Salir al menú',
            loading: 'Cargando', loadError: 'No se pudo cargar el juego.', retry: 'Reintentar', backToMenu: 'Volver al menú',
            padOn: 'Mando conectado', padOff: 'Mando desconectado. Juego en pausa.',
            inputRemote: 'Mando a distancia', inputPad: 'Mando', inputKeys: 'Teclado',
            version: 'Versión', build: 'Compilación', online: 'Actualización en línea', onlineYes: 'Sí (copia en línea)',
            onlineNo: 'No (copia integrada)', device: 'Perfil del dispositivo',
            adjustHint: 'Usa izquierda y derecha para cambiar',
            controlsText: [
                'Mando a distancia: flechas para moverse, OK para saltar o confirmar, mantén OK para saltar más, Atrás para pausar.',
                'Tecla roja: correr sí o no. Tecla Reproducir/Pausa: pausa.',
                'Mando: cruceta o stick izquierdo para moverse, A para saltar, B o X para correr o disparar, Start o Select para pausar.',
                'Teclado: flechas, Espacio o Z para saltar, Mayús o X para correr, Esc para pausar.',
                'Super Jumper para dos: abre el menú de pausa, elige Dos jugadores y el jugador 2 pulsa OK o A en su propio mando (otro mando, el mando a distancia, o W A S D + F en un teclado).'
            ],
            privacyText: [
                'Arcade no recopila, guarda ni comparte datos personales.',
                'El progreso y los ajustes se guardan solo en este televisor.',
                'Al iniciar, la aplicación descarga archivos de actualización desde imad-os.github.io. No se envía ningún identificador.',
                'Sin anuncios, cuentas ni compras.'
            ]
        },
        ar: {
            netOff: 'لا يوجد اتصال بالشبكة. ألعابك تعمل دون اتصال.', netOn: 'تم الاتصال بالشبكة',
            scores: 'أفضل النتائج', newHigh: 'نتيجة قياسية جديدة!', rank: 'المرتبة', entryHint: 'أعلى وأسفل: تغيير الحرف. يسار ويمين: تنقل. OK: حفظ.', save: 'حفظ', letter: 'الحرف', of: 'من', noScores: 'لا توجد نتائج بعد', player: 'اللاعب', points: 'نقطة',
            appTitle: 'آركيد', games: 'الألعاب', settings: 'الإعدادات', play: 'العب',
            badgeNew: 'جديد', badgeUpdated: 'محدّث', lastPlayed: 'آخر لعبة',
            language: 'اللغة', musicVol: 'مستوى الموسيقى', sfxVol: 'مستوى المؤثرات',
            graphics: 'جودة الرسوم', gfxAuto: 'تلقائي', gfxLow: 'منخفضة', gfxMid: 'متوسطة', gfxHigh: 'عالية',
            controls: 'مساعدة التحكم', resetProgress: 'إعادة ضبط التقدم', privacy: 'سياسة الخصوصية',
            about: 'حول', close: 'إغلاق', back: 'رجوع',
            exitTitle: 'الخروج من آركيد؟', exitText: 'هل تريد إغلاق التطبيق؟', yes: 'نعم', no: 'لا',
            resetTitle: 'إعادة ضبط التقدم؟', resetText: 'سيتم حذف كل التقدم وأفضل النتائج لهذا الملف الشخصي.',
            profiles: 'الملفات الشخصية', profile: 'الملف الشخصي', switchProfile: 'اضغط OK للتبديل أو لإنشاء ملف', active: 'يلعب الآن', switchHint: 'اضغط OK للعب بهذا الملف',
            profilesHint: 'لكل ملف تقدمه ونتائجه الخاصة.', newProfile: 'ملف جديد', renameProfile: 'إعادة التسمية', deleteProfile: 'حذف الملف',
            deleteTitle: 'حذف الملف؟', deleteText: 'سيتم حذف كل تقدم ونتائج %s.', hello: 'مرحباً', space: 'مسافة', erase: 'حذف حرف', cancel: 'إلغاء',
            namerHint: 'اختر الحروف بالأسهم و OK ثم اختر حفظ.',
            resetDone: 'تمت إعادة الضبط',
            paused: 'إيقاف مؤقت', resume: 'متابعة', quitToMenu: 'العودة إلى القائمة',
            loading: 'جارٍ التحميل', loadError: 'تعذّر تحميل اللعبة.', retry: 'إعادة المحاولة', backToMenu: 'العودة إلى القائمة',
            padOn: 'تم توصيل وحدة التحكم', padOff: 'تم فصل وحدة التحكم. اللعبة متوقفة.',
            inputRemote: 'جهاز التحكم', inputPad: 'وحدة تحكم', inputKeys: 'لوحة المفاتيح',
            version: 'الإصدار', build: 'البناء', online: 'تحديث عبر الإنترنت', onlineYes: 'نعم (نسخة مستضافة)',
            onlineNo: 'لا (نسخة مدمجة)', device: 'ملف الجهاز',
            adjustHint: 'استخدم اليسار واليمين للتغيير',
            controlsText: [
                'جهاز التحكم: الأسهم للتحرك، OK للقفز أو التأكيد، اضغط مطولاً على OK لقفزة أعلى، رجوع للإيقاف المؤقت.',
                'الزر الأحمر: تشغيل أو إيقاف الركض. زر تشغيل/إيقاف: إيقاف مؤقت.',
                'وحدة التحكم: الأسهم أو العصا اليسرى للتحرك، A للقفز، B أو X للركض أو الإطلاق، Start أو Select للإيقاف المؤقت.',
                'لوحة المفاتيح: الأسهم، المسافة أو Z للقفز، Shift أو X للركض، Esc للإيقاف المؤقت.',
                'سوبر جمبر للاعبَين: افتح قائمة الإيقاف واختر لاعبان، ثم يضغط اللاعب 2 على OK أو A في وحدة التحكم الخاصة به (وحدة تحكم أخرى، أو جهاز التحكم، أو W A S D و F على لوحة المفاتيح).'
            ],
            privacyText: [
                'لا يجمع آركيد أي بيانات شخصية ولا يخزنها ولا يشاركها.',
                'يتم حفظ التقدم والإعدادات على هذا التلفاز فقط.',
                'عند التشغيل يقوم التطبيق بتنزيل ملفات التحديث من imad-os.github.io. لا يتم إرسال أي معرّف.',
                'لا توجد إعلانات أو حسابات أو مشتريات.'
            ]
        }
    };

    var lang = Store.get('lang', null);
    if (LANGS.indexOf(lang) < 0) {
        var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
        lang = LANGS.indexOf(nav) >= 0 ? nav : 'en';
    }

    function t(k) {
        var v = S[lang][k];
        return v === undefined ? (S.en[k] === undefined ? k : S.en[k]) : v;
    }

    // Picks the current language from a {en:'..', fr:'..'} object (used by game manifests).
    function pick(obj) {
        if (!obj || typeof obj === 'string') return obj || '';
        return obj[lang] || obj.en || '';
    }

    function apply(root) {
        root = root || document;
        var html = document.documentElement;
        html.setAttribute('lang', lang);
        html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        var list = root.querySelectorAll('[data-i18n]'), i;
        for (i = 0; i < list.length; i++) list[i].textContent = t(list[i].getAttribute('data-i18n'));
        list = root.querySelectorAll('[data-i18n-aria-label]');
        for (i = 0; i < list.length; i++) list[i].setAttribute('aria-label', t(list[i].getAttribute('data-i18n-aria-label')));
    }

    function setLang(l) {
        if (LANGS.indexOf(l) < 0) return;
        lang = l;
        Store.set('lang', l);
        apply();
    }

    return {
        LANGS: LANGS, NAMES: NAMES, t: t, pick: pick, apply: apply, setLang: setLang,
        lang: function () { return lang; }, rtl: function () { return lang === 'ar'; }
    };
})();
