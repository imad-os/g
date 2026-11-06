/* Strings of MyMusic's online radio (js/core/radio.js, js/launcher/apps/music.js), in the 4 languages. %s is a number or a name.
 * Keep raPrivacy true when what the radio reads or sends changes. */
(function () {
    'use strict';
    I18n.add({
        en: {
            raTitle: 'Radio', raSub: 'Live stations', raStations: 'Stations', raNStations: '%s stations', raFavs: 'Favorite stations', raRecent: 'Recently played stations',
            raMine: 'My stations', raSearch: 'Search', raSearchT: 'Search a station or a genre', raSearchFor: 'Search: %s', raClear: 'Clear the search',
            raCountry: 'Country', raLang: 'Language', raGenre: 'Genre', raAll: 'All', raPick: 'Choose a country',
            raAdd: 'Add a station', raAddName: 'Name of the station', raAddUrl: 'Address of the stream (http://...)', raBadUrl: 'This is not a stream address (it starts with http:// or https://).',
            raAdded: 'Station added.', raSaved: 'Station saved.', raEdit: 'Edit', raDelete: 'Delete', raDeleted: 'Station deleted.',
            raLive: 'LIVE', raFav: 'Add to favorites', raUnfav: 'Remove from favorites', raFavOn: 'Added to favorites.', raFavOff: 'Removed from favorites.',
            raTest: 'Test this station', raTesting: 'Testing the station…', raWorks: 'This station works.', raBroken: 'This station does not answer.', raCant: 'This device cannot play this station.',
            raNotWorking: 'Not working', raShowBad: 'Show %s hidden stations', raHideBad: 'Hide the stations that do not work', raMore: 'Show more',
            raUpdated: 'Updated %s', raRefresh: 'Refresh', raNone: 'No station found.', raOffline: 'The station list cannot be reached. Check the internet connection.',
            raFrom: 'Radio · %s', raNoFavs: 'Hold OK on a station (or press +) to add it to your favorites.',
            raPrivacy: 'Online radio: the list of stations comes from radio-browser.info (a free public directory), which also counts the stations played; the sound comes from each station\'s own server. Your favorites, recently played and your own stations stay in this profile.'
        },
        fr: {
            raTitle: 'Radio', raSub: 'Stations en direct', raStations: 'Stations', raNStations: '%s stations', raFavs: 'Stations favorites', raRecent: 'Stations écoutées récemment',
            raMine: 'Mes stations', raSearch: 'Rechercher', raSearchT: 'Rechercher une station ou un genre', raSearchFor: 'Recherche : %s', raClear: 'Effacer la recherche',
            raCountry: 'Pays', raLang: 'Langue', raGenre: 'Genre', raAll: 'Tous', raPick: 'Choisir un pays',
            raAdd: 'Ajouter une station', raAddName: 'Nom de la station', raAddUrl: 'Adresse du flux (http://...)', raBadUrl: 'Ce n’est pas une adresse de flux (elle commence par http:// ou https://).',
            raAdded: 'Station ajoutée.', raSaved: 'Station enregistrée.', raEdit: 'Modifier', raDelete: 'Supprimer', raDeleted: 'Station supprimée.',
            raLive: 'EN DIRECT', raFav: 'Ajouter aux favoris', raUnfav: 'Retirer des favoris', raFavOn: 'Ajoutée aux favoris.', raFavOff: 'Retirée des favoris.',
            raTest: 'Tester cette station', raTesting: 'Test de la station…', raWorks: 'Cette station fonctionne.', raBroken: 'Cette station ne répond pas.', raCant: 'Cet appareil ne peut pas lire cette station.',
            raNotWorking: 'Ne fonctionne pas', raShowBad: 'Afficher %s stations masquées', raHideBad: 'Masquer les stations qui ne fonctionnent pas', raMore: 'Afficher plus',
            raUpdated: 'Mis à jour %s', raRefresh: 'Actualiser', raNone: 'Aucune station trouvée.', raOffline: 'La liste des stations est injoignable. Vérifiez la connexion internet.',
            raFrom: 'Radio · %s', raNoFavs: 'Maintenez OK sur une station (ou appuyez sur +) pour l’ajouter à vos favoris.',
            raPrivacy: 'Radio en ligne : la liste des stations vient de radio-browser.info (un annuaire public gratuit), qui compte aussi les stations écoutées ; le son vient du serveur de chaque station. Vos favoris, vos écoutes récentes et vos propres stations restent dans ce profil.'
        },
        es: {
            raTitle: 'Radio', raSub: 'Emisoras en directo', raStations: 'Emisoras', raNStations: '%s emisoras', raFavs: 'Emisoras favoritas', raRecent: 'Emisoras escuchadas hace poco',
            raMine: 'Mis emisoras', raSearch: 'Buscar', raSearchT: 'Buscar una emisora o un género', raSearchFor: 'Búsqueda: %s', raClear: 'Borrar la búsqueda',
            raCountry: 'País', raLang: 'Idioma', raGenre: 'Género', raAll: 'Todos', raPick: 'Elegir un país',
            raAdd: 'Añadir una emisora', raAddName: 'Nombre de la emisora', raAddUrl: 'Dirección del flujo (http://...)', raBadUrl: 'No es una dirección de flujo (empieza por http:// o https://).',
            raAdded: 'Emisora añadida.', raSaved: 'Emisora guardada.', raEdit: 'Editar', raDelete: 'Eliminar', raDeleted: 'Emisora eliminada.',
            raLive: 'EN DIRECTO', raFav: 'Añadir a favoritas', raUnfav: 'Quitar de favoritas', raFavOn: 'Añadida a favoritas.', raFavOff: 'Quitada de favoritas.',
            raTest: 'Probar esta emisora', raTesting: 'Probando la emisora…', raWorks: 'Esta emisora funciona.', raBroken: 'Esta emisora no responde.', raCant: 'Este dispositivo no puede reproducir esta emisora.',
            raNotWorking: 'No funciona', raShowBad: 'Mostrar %s emisoras ocultas', raHideBad: 'Ocultar las emisoras que no funcionan', raMore: 'Mostrar más',
            raUpdated: 'Actualizado %s', raRefresh: 'Actualizar', raNone: 'No se encontró ninguna emisora.', raOffline: 'No se puede obtener la lista de emisoras. Comprueba la conexión a internet.',
            raFrom: 'Radio · %s', raNoFavs: 'Mantén OK en una emisora (o pulsa +) para añadirla a tus favoritas.',
            raPrivacy: 'Radio en línea: la lista de emisoras viene de radio-browser.info (un directorio público gratuito), que también cuenta las emisoras escuchadas; el sonido llega del servidor de cada emisora. Tus favoritas, lo escuchado hace poco y tus propias emisoras se quedan en este perfil.'
        },
        ar: {
            raTitle: 'الراديو', raSub: 'محطات مباشرة', raStations: 'المحطات', raNStations: '%s محطة', raFavs: 'المحطات المفضلة', raRecent: 'محطات استمعت إليها مؤخرًا',
            raMine: 'محطاتي', raSearch: 'بحث', raSearchT: 'ابحث عن محطة أو نوع', raSearchFor: 'بحث: %s', raClear: 'مسح البحث',
            raCountry: 'البلد', raLang: 'اللغة', raGenre: 'النوع', raAll: 'الكل', raPick: 'اختر بلدًا',
            raAdd: 'إضافة محطة', raAddName: 'اسم المحطة', raAddUrl: 'عنوان البث (http://...)', raBadUrl: 'هذا ليس عنوان بث (يبدأ بـ http:// أو https://).',
            raAdded: 'تمت إضافة المحطة.', raSaved: 'تم حفظ المحطة.', raEdit: 'تعديل', raDelete: 'حذف', raDeleted: 'تم حذف المحطة.',
            raLive: 'مباشر', raFav: 'إضافة إلى المفضلة', raUnfav: 'إزالة من المفضلة', raFavOn: 'أُضيفت إلى المفضلة.', raFavOff: 'أُزيلت من المفضلة.',
            raTest: 'اختبار هذه المحطة', raTesting: 'جارٍ اختبار المحطة…', raWorks: 'هذه المحطة تعمل.', raBroken: 'هذه المحطة لا تستجيب.', raCant: 'لا يمكن لهذا الجهاز تشغيل هذه المحطة.',
            raNotWorking: 'لا تعمل', raShowBad: 'إظهار %s محطة مخفية', raHideBad: 'إخفاء المحطات التي لا تعمل', raMore: 'عرض المزيد',
            raUpdated: 'آخر تحديث %s', raRefresh: 'تحديث', raNone: 'لم يتم العثور على أي محطة.', raOffline: 'تعذر الوصول إلى قائمة المحطات. تحقق من الاتصال بالإنترنت.',
            raFrom: 'راديو · %s', raNoFavs: 'اضغط مطولًا على OK فوق محطة (أو اضغط +) لإضافتها إلى المفضلة.',
            raPrivacy: 'الراديو عبر الإنترنت: قائمة المحطات من radio-browser.info (دليل عام مجاني)، الذي يحصي أيضًا المحطات المُشغّلة؛ والصوت يأتي من خادم كل محطة. مفضلتك وما استمعت إليه مؤخرًا ومحطاتك الخاصة تبقى في هذا الملف الشخصي.'
        }
    });
})();
