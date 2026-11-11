/* Strings of the controller pages (Control Panel > Gaming and Devices, the controller test): which controller it is and
 * the names printed on its buttons (js/core/pad-info.js). Same 4 languages as i18n.js. */
(function () {
    'use strict';
    I18n.add({
        en: {
            padSwap: 'Swap A ↔ B and X ↔ Y', padSwapDesc: 'Samsung TVs and Android send a Nintendo pad’s A B X Y by letter; Automatic puts them back.', padOrd_auto: 'Automatic (%s)', padOrd_swap: 'Swap', padOrd_keep: 'Don\'t swap', padSwapped: 'A ↔ B and X ↔ Y swapped back',
            padSection: 'Your controllers', padNone: 'No controller connected. Plug one in (USB or Bluetooth), then press a button.',
            padBrand: 'Brand', padModel: 'Model', padUnknown: 'Unknown', padIds: 'USB id', padMap: 'Button order',
            padMapStd: 'standard (by place on the pad)', padMapRaw: 'not standard: the controller’s own order',
            padLayout: 'Button names', padLay_nintendo: 'Nintendo: B bottom, A right, Y left, X top',
            padLay_xbox: 'Xbox: A bottom, B right, X left, Y top', padLay_playstation: 'PlayStation: ✕ bottom, ○ right, □ left, △ top',
            padLay_other: 'Not known: My PC’s names (B bottom, A right, Y left, X top)',
            padWhy: 'My PC reads every controller by the PLACE of a button, never by its letter: the bottom button is OK / jump and the right one is Back on every controller. So on a Nintendo pad A (right) goes back and B (bottom) confirms, like on a Switch, and on an Xbox pad A (bottom) confirms. The test shows the names printed on your controller.',
            padTest: 'Test the buttons', padTestDesc: 'Press a button: its name, its number and what it does in My PC',
            padPress: 'Press a button on the controller.', padLast: '%b (button %i): %a', padNoAct: 'only for apps and games',
            padDo_ok: 'OK, jump', padDo_back: 'Back, run', padDo_run: 'run, fire', padDo_page: 'scroll a page', padDo_menu: 'menu (both held: My PC’s menu)',
            padDo_home: 'Start menu', padDo_dir: 'move', padActive: 'last used',
            padHelpMap: '%ok: OK · %back: Back · %l / %r: scroll a page · %home: Start menu · %menu: menu'
        },
        fr: {
            padSwap: 'Inverser A ↔ B et X ↔ Y', padSwapDesc: 'Les TV Samsung et Android envoient A B X Y d’une manette Nintendo par lettre ; Automatique les remet en place.', padOrd_auto: 'Automatique (%s)', padOrd_swap: 'Inverser', padOrd_keep: 'Ne pas inverser', padSwapped: 'A ↔ B et X ↔ Y remis en place',
            padSection: 'Vos manettes', padNone: 'Aucune manette connectée. Branchez-en une (USB ou Bluetooth), puis appuyez sur un bouton.',
            padBrand: 'Marque', padModel: 'Modèle', padUnknown: 'Inconnu', padIds: 'Identifiant USB', padMap: 'Ordre des boutons',
            padMapStd: 'standard (selon la place sur la manette)', padMapRaw: 'pas standard : l’ordre propre à la manette',
            padLayout: 'Noms des boutons', padLay_nintendo: 'Nintendo : B en bas, A à droite, Y à gauche, X en haut',
            padLay_xbox: 'Xbox : A en bas, B à droite, X à gauche, Y en haut', padLay_playstation: 'PlayStation : ✕ en bas, ○ à droite, □ à gauche, △ en haut',
            padLay_other: 'Inconnue : les noms de My PC (B en bas, A à droite, Y à gauche, X en haut)',
            padWhy: 'My PC lit chaque manette selon la PLACE d’un bouton, jamais sa lettre : le bouton du bas valide / saute et celui de droite revient en arrière sur toutes les manettes. Sur une manette Nintendo, A (à droite) revient donc en arrière et B (en bas) valide, comme sur une Switch ; sur une manette Xbox, A (en bas) valide. Le test montre les noms imprimés sur votre manette.',
            padTest: 'Tester les boutons', padTestDesc: 'Appuyez sur un bouton : son nom, son numéro et ce qu’il fait dans My PC',
            padPress: 'Appuyez sur un bouton de la manette.', padLast: '%b (bouton %i) : %a', padNoAct: 'seulement pour les applis et les jeux',
            padDo_ok: 'OK, sauter', padDo_back: 'Retour, courir', padDo_run: 'courir, tirer', padDo_page: 'défiler une page', padDo_menu: 'menu (les deux maintenus : menu de My PC)',
            padDo_home: 'menu Démarrer', padDo_dir: 'bouger', padActive: 'dernière utilisée',
            padHelpMap: '%ok : OK · %back : Retour · %l / %r : défiler une page · %home : menu Démarrer · %menu : menu'
        },
        es: {
            padSwap: 'Intercambiar A ↔ B y X ↔ Y', padSwapDesc: 'Las TV Samsung y Android envían A B X Y de un mando Nintendo por letra; Automático los pone en su sitio.', padOrd_auto: 'Automático (%s)', padOrd_swap: 'Intercambiar', padOrd_keep: 'No intercambiar', padSwapped: 'A ↔ B y X ↔ Y puestos en su sitio',
            padSection: 'Tus mandos', padNone: 'Ningún mando conectado. Conecta uno (USB o Bluetooth) y pulsa un botón.',
            padBrand: 'Marca', padModel: 'Modelo', padUnknown: 'Desconocido', padIds: 'Id USB', padMap: 'Orden de los botones',
            padMapStd: 'estándar (por su lugar en el mando)', padMapRaw: 'no estándar: el orden propio del mando',
            padLayout: 'Nombres de los botones', padLay_nintendo: 'Nintendo: B abajo, A a la derecha, Y a la izquierda, X arriba',
            padLay_xbox: 'Xbox: A abajo, B a la derecha, X a la izquierda, Y arriba', padLay_playstation: 'PlayStation: ✕ abajo, ○ a la derecha, □ a la izquierda, △ arriba',
            padLay_other: 'Desconocido: los nombres de My PC (B abajo, A a la derecha, Y a la izquierda, X arriba)',
            padWhy: 'My PC lee cada mando por el LUGAR de un botón, nunca por su letra: el botón de abajo es OK / saltar y el de la derecha es Atrás en todos los mandos. Así, en un mando Nintendo A (derecha) vuelve atrás y B (abajo) confirma, como en una Switch, y en un mando Xbox A (abajo) confirma. La prueba muestra los nombres impresos en tu mando.',
            padTest: 'Probar los botones', padTestDesc: 'Pulsa un botón: su nombre, su número y lo que hace en My PC',
            padPress: 'Pulsa un botón del mando.', padLast: '%b (botón %i): %a', padNoAct: 'solo para apps y juegos',
            padDo_ok: 'OK, saltar', padDo_back: 'Atrás, correr', padDo_run: 'correr, disparar', padDo_page: 'desplazar una página', padDo_menu: 'menú (los dos a la vez: menú de My PC)',
            padDo_home: 'menú Inicio', padDo_dir: 'moverse', padActive: 'el último usado',
            padHelpMap: '%ok: OK · %back: Atrás · %l / %r: desplazar una página · %home: menú Inicio · %menu: menú'
        },
        ar: {
            padSwap: 'تبديل A ↔ B و X ↔ Y', padSwapDesc: 'تلفاز Samsung وAndroid يرسلان A B X Y لوحدة Nintendo حسب الحرف؛ التلقائي يعيدها إلى مكانها.', padOrd_auto: 'تلقائي (%s)', padOrd_swap: 'تبديل', padOrd_keep: 'بدون تبديل', padSwapped: 'أُعيد A ↔ B و X ↔ Y إلى مكانهما',
            padSection: 'وحدات التحكم', padNone: 'لا توجد وحدة تحكم متصلة. وصّل واحدة (USB أو بلوتوث) ثم اضغط زرًا.',
            padBrand: 'العلامة', padModel: 'الطراز', padUnknown: 'غير معروف', padIds: 'معرّف USB', padMap: 'ترتيب الأزرار',
            padMapStd: 'قياسي (حسب مكان الزر في الوحدة)', padMapRaw: 'غير قياسي: ترتيب الوحدة الخاص',
            padLayout: 'أسماء الأزرار', padLay_nintendo: 'Nintendo: ‏B في الأسفل، A يمينًا، Y يسارًا، X في الأعلى',
            padLay_xbox: 'Xbox: ‏A في الأسفل، B يمينًا، X يسارًا، Y في الأعلى', padLay_playstation: 'PlayStation: ‏✕ في الأسفل، ○ يمينًا، □ يسارًا، △ في الأعلى',
            padLay_other: 'غير معروفة: أسماء My PC ‏(B في الأسفل، A يمينًا، Y يسارًا، X في الأعلى)',
            padWhy: 'يقرأ My PC كل وحدة تحكم حسب مكان الزر، لا حسب حرفه: الزر السفلي للتأكيد / القفز والأيمن للرجوع في كل الوحدات. لذلك في وحدة Nintendo يرجع A (يمينًا) ويؤكد B (في الأسفل) كما في Switch، وفي وحدة Xbox يؤكد A (في الأسفل). يعرض الاختبار الأسماء المطبوعة على وحدتك.',
            padTest: 'اختبار الأزرار', padTestDesc: 'اضغط زرًا: اسمه ورقمه وما يفعله في My PC',
            padPress: 'اضغط زرًا في وحدة التحكم.', padLast: '%b (الزر %i): %a', padNoAct: 'للتطبيقات والألعاب فقط',
            padDo_ok: 'موافق، قفز', padDo_back: 'رجوع، ركض', padDo_run: 'ركض، إطلاق', padDo_page: 'تمرير صفحة', padDo_menu: 'القائمة (الاثنان معًا: قائمة My PC)',
            padDo_home: 'قائمة ابدأ', padDo_dir: 'تحرك', padActive: 'آخر وحدة مستخدمة',
            padHelpMap: '%ok: موافق · %back: رجوع · %l / %r: تمرير صفحة · %home: قائمة ابدأ · %menu: القائمة'
        }
    });
})();
