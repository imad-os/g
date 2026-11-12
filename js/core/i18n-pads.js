/* Strings of the controller pages (Control Panel > Gaming and Devices, the controller test): which controller it is and
 * the names printed on its buttons (js/core/pad-info.js). Same 4 languages as i18n.js. */
(function () {
    'use strict';
    I18n.add({
        en: {
            padSwap: 'Swap A ↔ B and X ↔ Y', padSwapDesc: 'Chrome on a computer gives a Nintendo pad’s buttons by place (B first); Automatic puts A first there. Use the button test: A must light A.', padOrd_auto: 'Automatic (%s)', padOrd_swap: 'Swap', padOrd_keep: 'Don\'t swap', padSwapped: 'A ↔ B and X ↔ Y swapped back',
            padSection: 'Your controllers', padNone: 'No controller connected. Plug one in (USB or Bluetooth), then press a button.',
            padBrand: 'Brand', padModel: 'Model', padUnknown: 'Unknown', padIds: 'USB id', padMap: 'Button order',
            padMapStd: 'standard (by place on the pad)', padMapRaw: 'not standard: the controller’s own order',
            padLayout: 'Button names', padLay_nintendo: 'Nintendo: B bottom, A right, Y left, X top',
            padLay_xbox: 'Xbox: A bottom, B right, X left, Y top', padLay_playstation: 'PlayStation: ✕ bottom, ○ right, □ left, △ top',
            padLay_other: 'Not known: button 0 = A (OK), 1 = B (Back), 2 = X, 3 = Y',
            padWhy: 'On every controller, A is OK / jump and B is Back, like on a Nintendo Switch; X and Y run. On an Xbox pad A is the bottom button, on a Nintendo pad it is the right one: My PC follows the letter, not the place. The test shows the names printed on your controller and what each one does.',
            padTest: 'Test the buttons', padTestDesc: 'Press a button: its name, its number and what it does in My PC',
            padPress: 'Press a button on the controller.', padLast: '%b (button %i): %a', padNoAct: 'only for apps and games',
            padDo_ok: 'OK, jump', padDo_back: 'Back, run', padDo_run: 'run, fire', padDo_page: 'scroll a page', padDo_menu: 'menu (both held: My PC’s menu)',
            padDo_home: 'Start menu', padDo_dir: 'move', padActive: 'last used',
            padHelpMap: '%ok: OK · %back: Back · %l / %r: scroll a page · %home: Start menu · %menu: menu'
        },
        fr: {
            padSwap: 'Inverser A ↔ B et X ↔ Y', padSwapDesc: 'Chrome sur un ordinateur donne les boutons d’une manette Nintendo selon leur place (B d’abord) ; Automatique y remet A en premier. Vérifiez avec le test : A doit allumer A.', padOrd_auto: 'Automatique (%s)', padOrd_swap: 'Inverser', padOrd_keep: 'Ne pas inverser', padSwapped: 'A ↔ B et X ↔ Y remis en place',
            padSection: 'Vos manettes', padNone: 'Aucune manette connectée. Branchez-en une (USB ou Bluetooth), puis appuyez sur un bouton.',
            padBrand: 'Marque', padModel: 'Modèle', padUnknown: 'Inconnu', padIds: 'Identifiant USB', padMap: 'Ordre des boutons',
            padMapStd: 'standard (selon la place sur la manette)', padMapRaw: 'pas standard : l’ordre propre à la manette',
            padLayout: 'Noms des boutons', padLay_nintendo: 'Nintendo : B en bas, A à droite, Y à gauche, X en haut',
            padLay_xbox: 'Xbox : A en bas, B à droite, X à gauche, Y en haut', padLay_playstation: 'PlayStation : ✕ en bas, ○ à droite, □ à gauche, △ en haut',
            padLay_other: 'Inconnue : bouton 0 = A (OK), 1 = B (Retour), 2 = X, 3 = Y',
            padWhy: 'Sur toutes les manettes, A valide / saute et B revient en arrière, comme sur une Nintendo Switch ; X et Y font courir. Sur une manette Xbox A est en bas, sur une manette Nintendo à droite : My PC suit la lettre, pas la place. Le test montre les noms imprimés sur votre manette et ce que fait chacun.',
            padTest: 'Tester les boutons', padTestDesc: 'Appuyez sur un bouton : son nom, son numéro et ce qu’il fait dans My PC',
            padPress: 'Appuyez sur un bouton de la manette.', padLast: '%b (bouton %i) : %a', padNoAct: 'seulement pour les applis et les jeux',
            padDo_ok: 'OK, sauter', padDo_back: 'Retour, courir', padDo_run: 'courir, tirer', padDo_page: 'défiler une page', padDo_menu: 'menu (les deux maintenus : menu de My PC)',
            padDo_home: 'menu Démarrer', padDo_dir: 'bouger', padActive: 'dernière utilisée',
            padHelpMap: '%ok : OK · %back : Retour · %l / %r : défiler une page · %home : menu Démarrer · %menu : menu'
        },
        es: {
            padSwap: 'Intercambiar A ↔ B y X ↔ Y', padSwapDesc: 'Chrome en un ordenador da los botones de un mando Nintendo por su lugar (B primero); Automático pone A primero. Compruébalo con la prueba: A debe encender A.', padOrd_auto: 'Automático (%s)', padOrd_swap: 'Intercambiar', padOrd_keep: 'No intercambiar', padSwapped: 'A ↔ B y X ↔ Y puestos en su sitio',
            padSection: 'Tus mandos', padNone: 'Ningún mando conectado. Conecta uno (USB o Bluetooth) y pulsa un botón.',
            padBrand: 'Marca', padModel: 'Modelo', padUnknown: 'Desconocido', padIds: 'Id USB', padMap: 'Orden de los botones',
            padMapStd: 'estándar (por su lugar en el mando)', padMapRaw: 'no estándar: el orden propio del mando',
            padLayout: 'Nombres de los botones', padLay_nintendo: 'Nintendo: B abajo, A a la derecha, Y a la izquierda, X arriba',
            padLay_xbox: 'Xbox: A abajo, B a la derecha, X a la izquierda, Y arriba', padLay_playstation: 'PlayStation: ✕ abajo, ○ a la derecha, □ a la izquierda, △ arriba',
            padLay_other: 'Desconocido: botón 0 = A (OK), 1 = B (Atrás), 2 = X, 3 = Y',
            padWhy: 'En todos los mandos A es OK / saltar y B es Atrás, como en una Nintendo Switch; X e Y para correr. En un mando Xbox A está abajo, en un mando Nintendo a la derecha: My PC sigue la letra, no el lugar. La prueba muestra los nombres impresos en tu mando y lo que hace cada uno.',
            padTest: 'Probar los botones', padTestDesc: 'Pulsa un botón: su nombre, su número y lo que hace en My PC',
            padPress: 'Pulsa un botón del mando.', padLast: '%b (botón %i): %a', padNoAct: 'solo para apps y juegos',
            padDo_ok: 'OK, saltar', padDo_back: 'Atrás, correr', padDo_run: 'correr, disparar', padDo_page: 'desplazar una página', padDo_menu: 'menú (los dos a la vez: menú de My PC)',
            padDo_home: 'menú Inicio', padDo_dir: 'moverse', padActive: 'el último usado',
            padHelpMap: '%ok: OK · %back: Atrás · %l / %r: desplazar una página · %home: menú Inicio · %menu: menú'
        },
        ar: {
            padSwap: 'تبديل A ↔ B و X ↔ Y', padSwapDesc: 'Chrome على الكمبيوتر يعطي أزرار وحدة Nintendo حسب مكانها (B أولًا)؛ التلقائي يجعل A أولًا. تحقق بالاختبار: يجب أن يضيء A عند الضغط على A.', padOrd_auto: 'تلقائي (%s)', padOrd_swap: 'تبديل', padOrd_keep: 'بدون تبديل', padSwapped: 'أُعيد A ↔ B و X ↔ Y إلى مكانهما',
            padSection: 'وحدات التحكم', padNone: 'لا توجد وحدة تحكم متصلة. وصّل واحدة (USB أو بلوتوث) ثم اضغط زرًا.',
            padBrand: 'العلامة', padModel: 'الطراز', padUnknown: 'غير معروف', padIds: 'معرّف USB', padMap: 'ترتيب الأزرار',
            padMapStd: 'قياسي (حسب مكان الزر في الوحدة)', padMapRaw: 'غير قياسي: ترتيب الوحدة الخاص',
            padLayout: 'أسماء الأزرار', padLay_nintendo: 'Nintendo: ‏B في الأسفل، A يمينًا، Y يسارًا، X في الأعلى',
            padLay_xbox: 'Xbox: ‏A في الأسفل، B يمينًا، X يسارًا، Y في الأعلى', padLay_playstation: 'PlayStation: ‏✕ في الأسفل، ○ يمينًا، □ يسارًا، △ في الأعلى',
            padLay_other: 'غير معروفة: الزر 0 = A (موافق)، 1 = B (رجوع)، 2 = X، 3 = Y',
            padWhy: 'في كل وحدات التحكم A للتأكيد / القفز وB للرجوع، كما في Nintendo Switch؛ وX وY للركض. في وحدة Xbox يكون A في الأسفل، وفي وحدة Nintendo يمينًا: يتبع My PC الحرف لا المكان. يعرض الاختبار الأسماء المطبوعة على وحدتك وما يفعله كل زر.',
            padTest: 'اختبار الأزرار', padTestDesc: 'اضغط زرًا: اسمه ورقمه وما يفعله في My PC',
            padPress: 'اضغط زرًا في وحدة التحكم.', padLast: '%b (الزر %i): %a', padNoAct: 'للتطبيقات والألعاب فقط',
            padDo_ok: 'موافق، قفز', padDo_back: 'رجوع، ركض', padDo_run: 'ركض، إطلاق', padDo_page: 'تمرير صفحة', padDo_menu: 'القائمة (الاثنان معًا: قائمة My PC)',
            padDo_home: 'قائمة ابدأ', padDo_dir: 'تحرك', padActive: 'آخر وحدة مستخدمة',
            padHelpMap: '%ok: موافق · %back: رجوع · %l / %r: تمرير صفحة · %home: قائمة ابدأ · %menu: القائمة'
        }
    });
})();
