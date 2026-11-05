/* Strings of the Weather app (js/launcher/apps/weather.js), in the 4 languages. The conditions (wx_<k>), Wind, Humidity,
 * Place and Units come from i18n-widgets.js (shared with the desktop widget). */
(function () {
    'use strict';
    I18n.add({
        en: {
            wxWarn: 'Rain and storm warnings', wxWarnOff: 'Off', wxWarnH: 'Rain within %n h', wxWarnChip: 'Warnings: %s',
            wxTSize: 'Temperature size', wxISize: 'Picture size', wxSz_s: 'Small', wxSz_m: 'Medium', wxSz_l: 'Large', wxSz_xl: 'Extra large',
            wxWarning: 'Weather warning', wxDanger: 'Danger: storm',
            wxAlRainNow: 'Rain now', wxAlRainIn: 'Rain in about %n h (%t)', wxAlSnowNow: 'Snow now', wxAlSnowIn: 'Snow in about %n h (%t)',
            wxAlStormNow: 'Storm now: stay inside', wxAlStormIn: 'Storm danger in about %n h (%t)', wxNoAlert: 'No rain expected',
            weather: 'Weather', wxNow: 'Now', wxToday: 'Today', wxHours: 'Next 24 hours', wxWeek: '7-day forecast',
            wxFeels: 'Feels like %s', wxHi: 'H', wxLo: 'L', wxGusts: 'Gusts', wxPrecip: 'Precipitation', wxPop: 'chance of rain',
            wxPressure: 'Pressure', wxUv: 'UV index', wxUvL: 'Low,Moderate,High,Very high,Extreme', wxSunrise: 'Sunrise', wxSunset: 'Sunset', wxDaylight: 'Daylight',
            wxDirs: 'N,NE,E,SE,S,SW,W,NW', wxRefresh: 'Refresh', wxRefreshing: 'Refreshing…', wxUpdated: 'Updated %s',
            wxChangePlace: 'Change the place', wxAuto: 'found automatically', wxFinding: 'Finding your place…',
            wxNoPlace: 'Place not found: %s. Press the place above to choose another one.',
            wxLoadFail: 'Could not get the forecast. Check the internet connection, then press Refresh.'
        },
        fr: {
            wxWarn: 'Alertes pluie et orage', wxWarnOff: 'Désactivées', wxWarnH: 'Pluie dans les %n h', wxWarnChip: 'Alertes : %s',
            wxTSize: 'Taille de la température', wxISize: 'Taille de l’image', wxSz_s: 'Petite', wxSz_m: 'Moyenne', wxSz_l: 'Grande', wxSz_xl: 'Très grande',
            wxWarning: 'Alerte météo', wxDanger: 'Danger : orage',
            wxAlRainNow: 'Il pleut', wxAlRainIn: 'Pluie dans environ %n h (%t)', wxAlSnowNow: 'Il neige', wxAlSnowIn: 'Neige dans environ %n h (%t)',
            wxAlStormNow: 'Orage en cours : restez à l’abri', wxAlStormIn: 'Danger d’orage dans environ %n h (%t)', wxNoAlert: 'Pas de pluie prévue',
            weather: 'Météo', wxNow: 'Maintenant', wxToday: 'Aujourd’hui', wxHours: 'Prochaines 24 heures', wxWeek: 'Prévisions sur 7 jours',
            wxFeels: 'Ressenti %s', wxHi: 'Max', wxLo: 'Min', wxGusts: 'Rafales', wxPrecip: 'Précipitations', wxPop: 'risque de pluie',
            wxPressure: 'Pression', wxUv: 'Indice UV', wxUvL: 'Faible,Modéré,Élevé,Très élevé,Extrême', wxSunrise: 'Lever du soleil', wxSunset: 'Coucher du soleil', wxDaylight: 'Durée du jour',
            wxDirs: 'N,NE,E,SE,S,SO,O,NO', wxRefresh: 'Actualiser', wxRefreshing: 'Actualisation…', wxUpdated: 'Mis à jour à %s',
            wxChangePlace: 'Changer de lieu', wxAuto: 'trouvé automatiquement', wxFinding: 'Recherche de votre lieu…',
            wxNoPlace: 'Lieu introuvable : %s. Appuyez sur le lieu en haut pour en choisir un autre.',
            wxLoadFail: 'Impossible d’obtenir les prévisions. Vérifiez la connexion internet, puis appuyez sur Actualiser.'
        },
        es: {
            wxWarn: 'Avisos de lluvia y tormenta', wxWarnOff: 'Desactivados', wxWarnH: 'Lluvia en %n h', wxWarnChip: 'Avisos: %s',
            wxTSize: 'Tamaño de la temperatura', wxISize: 'Tamaño de la imagen', wxSz_s: 'Pequeño', wxSz_m: 'Mediano', wxSz_l: 'Grande', wxSz_xl: 'Muy grande',
            wxWarning: 'Aviso meteorológico', wxDanger: 'Peligro: tormenta',
            wxAlRainNow: 'Está lloviendo', wxAlRainIn: 'Lluvia en unas %n h (%t)', wxAlSnowNow: 'Está nevando', wxAlSnowIn: 'Nieve en unas %n h (%t)',
            wxAlStormNow: 'Tormenta ahora: quédate dentro', wxAlStormIn: 'Peligro de tormenta en unas %n h (%t)', wxNoAlert: 'No se espera lluvia',
            weather: 'Tiempo', wxNow: 'Ahora', wxToday: 'Hoy', wxHours: 'Próximas 24 horas', wxWeek: 'Previsión de 7 días',
            wxFeels: 'Sensación %s', wxHi: 'Máx', wxLo: 'Mín', wxGusts: 'Ráfagas', wxPrecip: 'Precipitación', wxPop: 'probabilidad de lluvia',
            wxPressure: 'Presión', wxUv: 'Índice UV', wxUvL: 'Bajo,Moderado,Alto,Muy alto,Extremo', wxSunrise: 'Amanecer', wxSunset: 'Atardecer', wxDaylight: 'Horas de luz',
            wxDirs: 'N,NE,E,SE,S,SO,O,NO', wxRefresh: 'Actualizar', wxRefreshing: 'Actualizando…', wxUpdated: 'Actualizado a las %s',
            wxChangePlace: 'Cambiar el lugar', wxAuto: 'encontrado automáticamente', wxFinding: 'Buscando tu lugar…',
            wxNoPlace: 'Lugar no encontrado: %s. Pulsa el lugar de arriba para elegir otro.',
            wxLoadFail: 'No se pudo obtener la previsión. Comprueba la conexión a internet y pulsa Actualizar.'
        },
        ar: {
            wxWarn: 'تنبيهات المطر والعواصف', wxWarnOff: 'متوقفة', wxWarnH: 'المطر خلال %n س', wxWarnChip: 'التنبيهات: %s',
            wxTSize: 'حجم درجة الحرارة', wxISize: 'حجم الصورة', wxSz_s: 'صغير', wxSz_m: 'متوسط', wxSz_l: 'كبير', wxSz_xl: 'كبير جداً',
            wxWarning: 'تنبيه الطقس', wxDanger: 'خطر: عاصفة',
            wxAlRainNow: 'تمطر الآن', wxAlRainIn: 'مطر بعد نحو %n س (%t)', wxAlSnowNow: 'تثلج الآن', wxAlSnowIn: 'ثلج بعد نحو %n س (%t)',
            wxAlStormNow: 'عاصفة الآن: ابقَ في الداخل', wxAlStormIn: 'خطر عاصفة بعد نحو %n س (%t)', wxNoAlert: 'لا مطر متوقع',
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
