/* Strings of roles (admin / user), themes and the Control Panel home (kept apart from i18n.js, same 4 languages).
 * Settings is called "Control Panel" (owner decision): the old name in the help texts that point to it is replaced too. */
(function () {
    'use strict';
    var OLD = { en: 'Settings >', fr: 'Paramètres >', es: 'Ajustes >', ar: 'الإعدادات >' };
    var S = {
        en: {
            settings: 'Control Panel', startWord: 'start',
            roleAdmin: 'Administrator', roleUser: 'User', role: 'Role', yourRole: 'Your role',
            roleDesc: 'Administrators install and uninstall apps, add and remove users and change the settings of the whole TV. Users use the apps and change their own things: theme, background, home screen, language, password.',
            adminOnly: 'Only an administrator can do this.', adminOnlyShort: 'Administrator only',
            adminOnlyInstall: 'Ask an administrator to install it.', adminOnlyUsers: 'Only an administrator can add or remove users.',
            lastAdmin: 'There must always be at least one administrator.',
            adminNoPw: 'Tip: make an account for this profile, so switching to it asks for its password.',
            otherUsers: 'Other users', otherUsersDesc: 'Roles, and removing users from this TV', addUser: 'Add a user',
            addUserDesc: 'A new account, or one made on another TV or phone', removeUser: 'Remove this user',
            removeUserText: '%s and all their settings and progress will be removed from this TV.', userRemoved: '%s was removed.',
            makeAdmin: 'Make administrator', makeUser: 'Make standard user', roleChanged: '%s is now: %r',
            theme: 'Theme', themeDesc: 'The look of the desktop, taskbar, Start and windows. Only for your profile.',
            th_win11: 'Windows 11 style', th_win7: 'Windows 7 style', th_xp: 'Windows XP style', th_mac: 'Mac style', th_android: 'Android style', th_ios: 'iOS style',
            wp_aero: 'Glass', wp_hills: 'Green hills', wp_dunes: 'Dunes', wp_material: 'Material', wp_lagoon: 'Lagoon',
            cpHint: 'Pick a category',
            cpd_system: 'Graphics, device, network, storage', cpd_personal: 'Theme, background', cpd_apps: 'Installed apps, App Store',
            cpd_accounts: 'Your profile, password, other users', cpd_sound: 'Music and effects volume', cpd_devices: 'Controllers, phone controller, keyboard',
            cpd_time: 'Language, clock, date', cpd_gaming: 'Controls, reset progress', cpd_ai: 'AI services for apps',
            cpd_privacy: 'Cloud backup, world records, permissions', cpd_about: 'Version and device', cpd_update: 'Check for My PC updates'
        },
        fr: {
            settings: 'Panneau de configuration', startWord: 'démarrer',
            roleAdmin: 'Administrateur', roleUser: 'Utilisateur', role: 'Rôle', yourRole: 'Votre rôle',
            roleDesc: 'Les administrateurs installent et désinstallent les applis, ajoutent et retirent des utilisateurs et règlent toute la TV. Les utilisateurs se servent des applis et changent leurs propres réglages : thème, fond d’écran, écran d’accueil, langue, mot de passe.',
            adminOnly: 'Seul un administrateur peut faire cela.', adminOnlyShort: 'Administrateur uniquement',
            adminOnlyInstall: 'Demandez à un administrateur de l’installer.', adminOnlyUsers: 'Seul un administrateur peut ajouter ou retirer des utilisateurs.',
            lastAdmin: 'Il faut toujours au moins un administrateur.',
            adminNoPw: 'Conseil : créez un compte pour ce profil, ainsi passer à ce profil demandera son mot de passe.',
            otherUsers: 'Autres utilisateurs', otherUsersDesc: 'Rôles, et retirer des utilisateurs de cette TV', addUser: 'Ajouter un utilisateur',
            addUserDesc: 'Un nouveau compte, ou un compte créé sur une autre TV ou un téléphone', removeUser: 'Retirer cet utilisateur',
            removeUserText: '%s et tous ses réglages et progrès seront retirés de cette TV.', userRemoved: '%s a été retiré.',
            makeAdmin: 'Rendre administrateur', makeUser: 'Rendre utilisateur standard', roleChanged: '%s est maintenant : %r',
            theme: 'Thème', themeDesc: 'L’apparence du bureau, de la barre des tâches, de Démarrer et des fenêtres. Pour votre profil seulement.',
            th_win11: 'Style Windows 11', th_win7: 'Style Windows 7', th_xp: 'Style Windows XP', th_mac: 'Style Mac', th_android: 'Style Android', th_ios: 'Style iOS',
            wp_aero: 'Verre', wp_hills: 'Collines vertes', wp_dunes: 'Dunes', wp_material: 'Material', wp_lagoon: 'Lagon',
            cpHint: 'Choisissez une catégorie',
            cpd_system: 'Graphismes, appareil, réseau, stockage', cpd_personal: 'Thème, fond d’écran', cpd_apps: 'Applis installées, App Store',
            cpd_accounts: 'Votre profil, mot de passe, autres utilisateurs', cpd_sound: 'Volume de la musique et des effets', cpd_devices: 'Manettes, téléphone manette, clavier',
            cpd_time: 'Langue, horloge, date', cpd_gaming: 'Commandes, remise à zéro', cpd_ai: 'Services d’IA pour les applis',
            cpd_privacy: 'Sauvegarde, records mondiaux, autorisations', cpd_about: 'Version et appareil', cpd_update: 'Rechercher des mises à jour de My PC'
        },
        es: {
            settings: 'Panel de control', startWord: 'inicio',
            roleAdmin: 'Administrador', roleUser: 'Usuario', role: 'Función', yourRole: 'Tu función',
            roleDesc: 'Los administradores instalan y desinstalan apps, añaden y quitan usuarios y cambian los ajustes de toda la TV. Los usuarios usan las apps y cambian lo suyo: tema, fondo, pantalla de inicio, idioma, contraseña.',
            adminOnly: 'Solo un administrador puede hacer esto.', adminOnlyShort: 'Solo administradores',
            adminOnlyInstall: 'Pide a un administrador que lo instale.', adminOnlyUsers: 'Solo un administrador puede añadir o quitar usuarios.',
            lastAdmin: 'Siempre debe haber al menos un administrador.',
            adminNoPw: 'Consejo: crea una cuenta para este perfil, así cambiar a él pedirá su contraseña.',
            otherUsers: 'Otros usuarios', otherUsersDesc: 'Funciones, y quitar usuarios de esta TV', addUser: 'Añadir un usuario',
            addUserDesc: 'Una cuenta nueva, o una creada en otra TV o teléfono', removeUser: 'Quitar este usuario',
            removeUserText: '%s y todos sus ajustes y progreso se quitarán de esta TV.', userRemoved: 'Se quitó a %s.',
            makeAdmin: 'Hacer administrador', makeUser: 'Hacer usuario estándar', roleChanged: '%s ahora es: %r',
            theme: 'Tema', themeDesc: 'El aspecto del escritorio, la barra de tareas, Inicio y las ventanas. Solo para tu perfil.',
            th_win11: 'Estilo Windows 11', th_win7: 'Estilo Windows 7', th_xp: 'Estilo Windows XP', th_mac: 'Estilo Mac', th_android: 'Estilo Android', th_ios: 'Estilo iOS',
            wp_aero: 'Cristal', wp_hills: 'Colinas verdes', wp_dunes: 'Dunas', wp_material: 'Material', wp_lagoon: 'Laguna',
            cpHint: 'Elige una categoría',
            cpd_system: 'Gráficos, dispositivo, red, almacenamiento', cpd_personal: 'Tema, fondo', cpd_apps: 'Apps instaladas, App Store',
            cpd_accounts: 'Tu perfil, contraseña, otros usuarios', cpd_sound: 'Volumen de música y efectos', cpd_devices: 'Mandos, teléfono como mando, teclado',
            cpd_time: 'Idioma, reloj, fecha', cpd_gaming: 'Controles, borrar progreso', cpd_ai: 'Servicios de IA para apps',
            cpd_privacy: 'Copia en la nube, récords mundiales, permisos', cpd_about: 'Versión y dispositivo', cpd_update: 'Buscar actualizaciones de My PC'
        },
        ar: {
            settings: 'لوحة التحكم', startWord: 'ابدأ',
            roleAdmin: 'مسؤول', roleUser: 'مستخدم', role: 'الدور', yourRole: 'دورك',
            roleDesc: 'المسؤولون يثبتون التطبيقات ويزيلونها، ويضيفون المستخدمين ويحذفونهم، ويغيرون إعدادات التلفاز كله. المستخدمون يستعملون التطبيقات ويغيرون أشياءهم الخاصة: السمة والخلفية والشاشة الرئيسية واللغة وكلمة المرور.',
            adminOnly: 'لا يمكن القيام بهذا إلا لمسؤول.', adminOnlyShort: 'للمسؤول فقط',
            adminOnlyInstall: 'اطلب من مسؤول تثبيته.', adminOnlyUsers: 'لا يمكن إضافة المستخدمين أو حذفهم إلا لمسؤول.',
            lastAdmin: 'يجب أن يبقى مسؤول واحد على الأقل.',
            adminNoPw: 'نصيحة: أنشئ حسابا لهذا الملف، فيطلب التبديل إليه كلمة مروره.',
            otherUsers: 'مستخدمون آخرون', otherUsersDesc: 'الأدوار، وحذف المستخدمين من هذا التلفاز', addUser: 'إضافة مستخدم',
            addUserDesc: 'حساب جديد، أو حساب أنشئ على تلفاز أو هاتف آخر', removeUser: 'حذف هذا المستخدم',
            removeUserText: 'سيحذف %s وكل إعداداته وتقدمه من هذا التلفاز.', userRemoved: 'تم حذف %s.',
            makeAdmin: 'جعله مسؤولا', makeUser: 'جعله مستخدما عاديا', roleChanged: '%s الآن: %r',
            theme: 'السمة', themeDesc: 'مظهر سطح المكتب وشريط المهام وقائمة ابدأ والنوافذ. لملفك فقط.',
            th_win11: 'نمط Windows 11', th_win7: 'نمط Windows 7', th_xp: 'نمط Windows XP', th_mac: 'نمط Mac', th_android: 'نمط Android', th_ios: 'نمط iOS',
            wp_aero: 'زجاج', wp_hills: 'تلال خضراء', wp_dunes: 'كثبان', wp_material: 'ماتيريال', wp_lagoon: 'بحيرة',
            cpHint: 'اختر فئة',
            cpd_system: 'الرسومات، الجهاز، الشبكة، التخزين', cpd_personal: 'السمة، الخلفية', cpd_apps: 'التطبيقات المثبتة، متجر التطبيقات',
            cpd_accounts: 'ملفك، كلمة المرور، مستخدمون آخرون', cpd_sound: 'مستوى الموسيقى والمؤثرات', cpd_devices: 'أذرع التحكم، الهاتف كذراع، لوحة المفاتيح',
            cpd_time: 'اللغة، الساعة، التاريخ', cpd_gaming: 'التحكم، مسح التقدم', cpd_ai: 'خدمات الذكاء الاصطناعي للتطبيقات',
            cpd_privacy: 'النسخ السحابي، الأرقام العالمية، الأذونات', cpd_about: 'الإصدار والجهاز', cpd_update: 'البحث عن تحديثات My PC'
        }
    };
    // the help texts that say "Settings > ..." now say "Control Panel > ..."
    ['gcTvTune', 'gcHelpQr', 'gcHelp'].forEach(function (k) {
        for (var l in OLD) {
            var v = I18n.raw(l, k);
            if (typeof v === 'string') S[l][k] = v.split(OLD[l]).join(S[l].settings + ' >');
        }
    });
    I18n.add(S);
})();
