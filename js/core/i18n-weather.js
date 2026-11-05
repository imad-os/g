/* Strings of the Weather app (js/launcher/apps/weather.js), in the 4 languages. The conditions (wx_<k>), Wind, Humidity,
 * Place and Units come from i18n-widgets.js (shared with the desktop widget). */
(function () {
    'use strict';
    I18n.add({
        en: {
            weather: 'Weather', wxNow: 'Now', wxToday: 'Today', wxHours: 'Next 24 hours', wxWeek: '7-day forecast',
            wxFeels: 'Feels like %s', wxHi: 'H', wxLo: 'L', wxGusts: 'Gusts', wxPrecip: 'Precipitation', wxPop: 'chance of rain',
            wxPressure: 'Pressure', wxUv: 'UV index', wxUvL: 'Low,Moderate,High,Very high,Extreme', wxSunrise: 'Sunrise', wxSunset: 'Sunset', wxDaylight: 'Daylight',
            wxDirs: 'N,NE,E,SE,S,SW,W,NW', wxRefresh: 'Refresh', wxRefreshing: 'Refreshing…', wxUpdated: 'Updated %s',
            wxChangePlace: 'Change the place', wxAuto: 'found automatically', wxFinding: 'Finding your place…',
            wxNoPlace: 'Place not found: %s. Press the place above to choose another one.',
            wxLoadFail: 'Could not get the forecast. Check the internet connection, then press Refresh.'
        },
        fr: {
            weather: 'Météo', wxNow: 'Maintenant', wxToday: 'Aujourd’hui', wxHours: 'Prochaines 24 heures', wxWeek: 'Prévisions sur 7 jours',
            wxFeels: 'Ressenti %s', wxHi: 'Max', wxLo: 'Min', wxGusts: 'Rafales', wxPrecip: 'Précipitations', wxPop: 'risque de pluie',
            wxPressure: 'Pression', wxUv: 'Indice UV', wxUvL: 'Faible,Modéré,Élevé,Très élevé,Extrême', wxSunrise: 'Lever du soleil', wxSunset: 'Coucher du soleil', wxDaylight: 'Durée du jour',
            wxDirs: 'N,NE,E,SE,S,SO,O,NO', wxRefresh: 'Actualiser', wxRefreshing: 'Actualisation…', wxUpdated: 'Mis à jour à %s',
            wxChangePlace: 'Changer de lieu', wxAuto: 'trouvé automatiquement', wxFinding: 'Recherche de votre lieu…',
            wxNoPlace: 'Lieu introuvable : %s. Appuyez sur le lieu en haut pour en choisir un autre.',
            wxLoadFail: 'Impossible d’obtenir les prévisions. Vérifiez la connexion internet, puis appuyez sur Actualiser.'
        },
        es: {
            weather: 'Tiempo', wxNow: 'Ahora', wxToday: 'Hoy', wxHours: 'Próximas 24 horas', wxWeek: 'Previsión de 7 días',
            wxFeels: 'Sensación %s', wxHi: 'Máx', wxLo: 'Mín', wxGusts: 'Ráfagas', wxPrecip: 'Precipitación', wxPop: 'probabilidad de lluvia',
            wxPressure: 'Presión', wxUv: 'Índice UV', wxUvL: 'Bajo,Moderado,Alto,Muy alto,Extremo', wxSunrise: 'Amanecer', wxSunset: 'Atardecer', wxDaylight: 'Horas de luz',
            wxDirs: 'N,NE,E,SE,S,SO,O,NO', wxRefresh: 'Actualizar', wxRefreshing: 'Actualizando…', wxUpdated: 'Actualizado a las %s',
            wxChangePlace: 'Cambiar el lugar', wxAuto: 'encontrado automáticamente', wxFinding: 'Buscando tu lugar…',
            wxNoPlace: 'Lugar no encontrado: %s. Pulsa el lugar de arriba para elegir otro.',
            wxLoadFail: 'No se pudo obtener la previsión. Comprueba la conexión a internet y pulsa Actualizar.'
        },
        ar: {
            weather: 'الطقس', wxNow: 'الآن', wxToday: 'اليوم', wxHours: 'الساعات الـ24 القادمة', wxWeek: 'توقعات 7 أيام',
            wxFeels: 'الإحساس %s', wxHi: 'العظمى', wxLo: 'الصغرى', wxGusts: 'الهبّات', wxPrecip: 'الهطول', wxPop: 'احتمال المطر',
            wxPressure: 'الضغط', wxUv: 'مؤشر UV', wxUvL: 'منخفض,معتدل,مرتفع,مرتفع جداً,شديد', wxSunrise: 'الشروق', wxSunset: 'الغروب', wxDaylight: 'طول النهار',
            wxDirs: 'ش,ش.ق,ق,ج.ق,ج,ج.غ,غ,ش.غ', wxRefresh: 'تحديث', wxRefreshing: 'جارٍ التحديث…', wxUpdated: 'حُدّث %s',
            wxChangePlace: 'تغيير المكان', wxAuto: 'تم تحديده تلقائياً', wxFinding: 'جارٍ تحديد مكانك…',
            wxNoPlace: 'لم يُعثر على المكان: %s. اضغط على المكان في الأعلى لاختيار مكان آخر.',
            wxLoadFail: 'تعذّر جلب التوقعات. تحقّق من الاتصال بالإنترنت ثم اضغط تحديث.'
        }
    });
})();
