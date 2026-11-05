/* Strings of the live backgrounds (js/launcher/dynwall.js) and of the events (js/core/events.js), in the 4 languages. */
(function () {
    'use strict';
    var S = {
        en: {
            dwCaptionAstro: 'Show the title and the Moon’s phase',
            dwAbout_dyn_weather: 'the sky of your place right now (sun, clouds, rain, snow, fog or storm), dawn, day, dusk and night, the season and the temperature. It uses the place and units of the Weather widget and checks again every 10 minutes while the desktop is on screen.',
            dwAbout_dyn_astro: 'the Earth seen from space over your place, with the real line between day and night, city lights on the night side and the Moon in its phase. Drawn again every 10 minutes while the desktop is on screen.',
            dwAbout_dyn_events: 'changes with the day: Moroccan holidays (Eid al-Fitr, Eid al-Adha, Ramadan, Throne Day, Green March…), football nights, and the season on other days. The evening before a holiday it already shows it.',
            wp_dyn_weather: 'Live weather', wp_dyn_astro: 'Earth now', wp_dyn_events: 'Holidays and events',
            dwMotion: 'Moving rain and snow', dwMotionDesc: 'Rain and snow fall on the picture. Uses a little more power.',
            dwCountry: 'Holidays of', dwFootball: 'Football nights', dwFootballDesc: 'Champions League, World Cup, AFCON and Morocco’s matches',
            dwCaption: 'Show the event’s name', dwTomorrow: 'Tomorrow: %s', dwDay: 'Day %n', dwEarth: 'Day and night on Earth now', dwMoon: 'Moon: %s',
            dwLiveBg: 'Live backgrounds',
            mp: 'New moon,Waxing crescent,First quarter,Waxing gibbous,Full moon,Waning gibbous,Last quarter,Waning crescent',
            cc_ma: 'Morocco', cc_dz: 'Algeria', cc_tn: 'Tunisia', cc_eg: 'Egypt', cc_sa: 'Saudi Arabia', cc_ae: 'United Arab Emirates',
            cc_fr: 'France', cc_es: 'Spain', cc_be: 'Belgium', cc_gb: 'United Kingdom', cc_us: 'United States',
            ev_newyear: 'New Year’s Day', ev_nye: 'New Year’s Eve', ev_manifesto: 'Independence Manifesto Day', ev_yennayer: 'Amazigh New Year',
            ev_labour: 'Labour Day', ev_throne: 'Throne Day', ev_oued: 'Oued Ed-Dahab Day', ev_revolution: 'Revolution of the King and the People',
            ev_youth: 'Youth Day', ev_unity: 'Unity Day', ev_greenmarch: 'Green March Day', ev_independence: 'Independence Day',
            ev_eidfitr: 'Eid al-Fitr', ev_eidadha: 'Eid al-Adha', ev_hijri: 'Islamic New Year', ev_mawlid: 'The Prophet’s Birthday (Mawlid)',
            ev_ramadan: 'Ramadan', ev_christmas: 'Christmas', ev_ucl: 'Champions League night', ev_uclfinal: 'Champions League final',
            ev_worldcup: 'World Cup', ev_afcon: 'Africa Cup of Nations', ev_morocco: 'Morocco plays today',
            evg_eid: 'Eid Mubarak', evg_ramadan: 'Ramadan Kareem', evg_newyear: 'Happy New Year',
            evPrivacy: 'Holidays and events background: the public holidays come from Google Calendar (google.com) and the football matches from ESPN (espn.com); nothing about you is sent. Live weather uses the weather service below. Choose another background to stop it.'
        },
        fr: {
            dwCaptionAstro: 'Afficher le titre et la phase de la Lune',
            dwAbout_dyn_weather: 'le ciel de votre lieu en ce moment (soleil, nuages, pluie, neige, brouillard ou orage), l’aube, le jour, le crépuscule et la nuit, la saison et la température. Utilise le lieu et les unités du widget Météo et se met à jour toutes les 10 minutes quand le bureau est affiché.',
            dwAbout_dyn_astro: 'la Terre vue de l’espace au-dessus de votre lieu, avec la vraie limite entre le jour et la nuit, les lumières des villes côté nuit et la Lune dans sa phase. Redessinée toutes les 10 minutes quand le bureau est affiché.',
            dwAbout_dyn_events: 'change avec le jour : fêtes marocaines (Aïd al-Fitr, Aïd al-Adha, Ramadan, Fête du Trône, Marche verte…), soirées de football et la saison les autres jours. La veille d’une fête, elle l’affiche déjà.',
            wp_dyn_weather: 'Météo en direct', wp_dyn_astro: 'La Terre en direct', wp_dyn_events: 'Fêtes et événements',
            dwMotion: 'Pluie et neige animées', dwMotionDesc: 'La pluie et la neige tombent sur l’image. Consomme un peu plus.',
            dwCountry: 'Jours fériés de', dwFootball: 'Soirées de football', dwFootballDesc: 'Ligue des champions, Coupe du monde, CAN et matchs du Maroc',
            dwCaption: 'Afficher le nom de l’événement', dwTomorrow: 'Demain : %s', dwDay: 'Jour %n', dwEarth: 'Le jour et la nuit sur la Terre maintenant', dwMoon: 'Lune : %s',
            dwLiveBg: 'Arrière-plans en direct',
            mp: 'Nouvelle lune,Premier croissant,Premier quartier,Gibbeuse croissante,Pleine lune,Gibbeuse décroissante,Dernier quartier,Dernier croissant',
            cc_ma: 'Maroc', cc_dz: 'Algérie', cc_tn: 'Tunisie', cc_eg: 'Égypte', cc_sa: 'Arabie saoudite', cc_ae: 'Émirats arabes unis',
            cc_fr: 'France', cc_es: 'Espagne', cc_be: 'Belgique', cc_gb: 'Royaume-Uni', cc_us: 'États-Unis',
            ev_newyear: 'Jour de l’An', ev_nye: 'Réveillon du Nouvel An', ev_manifesto: 'Manifeste de l’Indépendance', ev_yennayer: 'Nouvel An amazigh',
            ev_labour: 'Fête du Travail', ev_throne: 'Fête du Trône', ev_oued: 'Journée d’Oued Ed-Dahab', ev_revolution: 'Révolution du Roi et du Peuple',
            ev_youth: 'Fête de la Jeunesse', ev_unity: 'Fête de l’Unité', ev_greenmarch: 'Marche verte', ev_independence: 'Fête de l’Indépendance',
            ev_eidfitr: 'Aïd al-Fitr', ev_eidadha: 'Aïd al-Adha', ev_hijri: 'Nouvel An de l’Hégire', ev_mawlid: 'Naissance du Prophète (Mawlid)',
            ev_ramadan: 'Ramadan', ev_christmas: 'Noël', ev_ucl: 'Soirée de Ligue des champions', ev_uclfinal: 'Finale de la Ligue des champions',
            ev_worldcup: 'Coupe du monde', ev_afcon: 'Coupe d’Afrique des nations', ev_morocco: 'Le Maroc joue aujourd’hui',
            evg_eid: 'Aïd Moubarak', evg_ramadan: 'Ramadan Karim', evg_newyear: 'Bonne année',
            evPrivacy: 'Arrière-plan Fêtes et événements : les jours fériés viennent de Google Agenda (google.com) et les matchs de football d’ESPN (espn.com) ; rien sur vous n’est envoyé. Météo en direct utilise le service météo ci-dessous. Choisissez un autre arrière-plan pour l’arrêter.'
        },
        es: {
            dwCaptionAstro: 'Mostrar el título y la fase de la Luna',
            dwAbout_dyn_weather: 'el cielo de tu lugar ahora mismo (sol, nubes, lluvia, nieve, niebla o tormenta), el amanecer, el día, el atardecer y la noche, la estación y la temperatura. Usa el lugar y las unidades del widget del Tiempo y se actualiza cada 10 minutos mientras se ve el escritorio.',
            dwAbout_dyn_astro: 'la Tierra vista desde el espacio sobre tu lugar, con la línea real entre el día y la noche, las luces de las ciudades en el lado de noche y la Luna en su fase. Se vuelve a dibujar cada 10 minutos mientras se ve el escritorio.',
            dwAbout_dyn_events: 'cambia con el día: fiestas marroquíes (Eid al-Fitr, Eid al-Adha, Ramadán, Fiesta del Trono, Marcha Verde…), noches de fútbol y la estación los demás días. La víspera de una fiesta ya la muestra.',
            wp_dyn_weather: 'Tiempo en directo', wp_dyn_astro: 'La Tierra ahora', wp_dyn_events: 'Fiestas y eventos',
            dwMotion: 'Lluvia y nieve en movimiento', dwMotionDesc: 'La lluvia y la nieve caen sobre la imagen. Gasta un poco más.',
            dwCountry: 'Festivos de', dwFootball: 'Noches de fútbol', dwFootballDesc: 'Liga de Campeones, Mundial, Copa de África y partidos de Marruecos',
            dwCaption: 'Mostrar el nombre del evento', dwTomorrow: 'Mañana: %s', dwDay: 'Día %n', dwEarth: 'El día y la noche en la Tierra ahora', dwMoon: 'Luna: %s',
            dwLiveBg: 'Fondos en directo',
            mp: 'Luna nueva,Luna creciente,Cuarto creciente,Gibosa creciente,Luna llena,Gibosa menguante,Cuarto menguante,Luna menguante',
            cc_ma: 'Marruecos', cc_dz: 'Argelia', cc_tn: 'Túnez', cc_eg: 'Egipto', cc_sa: 'Arabia Saudí', cc_ae: 'Emiratos Árabes Unidos',
            cc_fr: 'Francia', cc_es: 'España', cc_be: 'Bélgica', cc_gb: 'Reino Unido', cc_us: 'Estados Unidos',
            ev_newyear: 'Año Nuevo', ev_nye: 'Nochevieja', ev_manifesto: 'Manifiesto de la Independencia', ev_yennayer: 'Año Nuevo amazigh',
            ev_labour: 'Día del Trabajo', ev_throne: 'Fiesta del Trono', ev_oued: 'Día de Oued Ed-Dahab', ev_revolution: 'Revolución del Rey y del Pueblo',
            ev_youth: 'Día de la Juventud', ev_unity: 'Día de la Unidad', ev_greenmarch: 'Marcha Verde', ev_independence: 'Día de la Independencia',
            ev_eidfitr: 'Eid al-Fitr', ev_eidadha: 'Eid al-Adha', ev_hijri: 'Año Nuevo islámico', ev_mawlid: 'Nacimiento del Profeta (Mawlid)',
            ev_ramadan: 'Ramadán', ev_christmas: 'Navidad', ev_ucl: 'Noche de Liga de Campeones', ev_uclfinal: 'Final de la Liga de Campeones',
            ev_worldcup: 'Mundial', ev_afcon: 'Copa Africana de Naciones', ev_morocco: 'Marruecos juega hoy',
            evg_eid: 'Eid Mubarak', evg_ramadan: 'Ramadán Karim', evg_newyear: 'Feliz Año Nuevo',
            evPrivacy: 'Fondo Fiestas y eventos: los festivos vienen de Google Calendar (google.com) y los partidos de fútbol de ESPN (espn.com); no se envía nada sobre ti. Tiempo en directo usa el servicio del tiempo de abajo. Elige otro fondo para detenerlo.'
        },
        ar: {
            dwCaptionAstro: 'إظهار العنوان وطور القمر',
            dwAbout_dyn_weather: 'سماء مكانك الآن (شمس، غيوم، مطر، ثلج، ضباب أو عاصفة)، والفجر والنهار والغروب والليل، والفصل ودرجة الحرارة. تستخدم مكان ووحدات أداة الطقس وتتحدث كل 10 دقائق ما دام سطح المكتب ظاهراً.',
            dwAbout_dyn_astro: 'الأرض من الفضاء فوق مكانك، مع الخط الحقيقي بين الليل والنهار وأضواء المدن في جانب الليل والقمر في طوره. تُرسم من جديد كل 10 دقائق ما دام سطح المكتب ظاهراً.',
            dwAbout_dyn_events: 'تتغير مع اليوم: الأعياد المغربية (عيد الفطر، عيد الأضحى، رمضان، عيد العرش، المسيرة الخضراء…)، وأمسيات كرة القدم، والفصل في باقي الأيام. في مساء ما قبل العيد تظهره مسبقاً.',
            wp_dyn_weather: 'الطقس المباشر', wp_dyn_astro: 'الأرض الآن', wp_dyn_events: 'الأعياد والمناسبات',
            dwMotion: 'مطر وثلج متحركان', dwMotionDesc: 'يتساقط المطر والثلج على الصورة. تستهلك قليلاً أكثر.',
            dwCountry: 'عطل', dwFootball: 'أمسيات كرة القدم', dwFootballDesc: 'دوري أبطال أوروبا وكأس العالم وكأس أمم أفريقيا ومباريات المغرب',
            dwCaption: 'إظهار اسم المناسبة', dwTomorrow: 'غداً: %s', dwDay: 'اليوم %n', dwEarth: 'الليل والنهار على الأرض الآن', dwMoon: 'القمر: %s',
            dwLiveBg: 'خلفيات مباشرة',
            mp: 'محاق,هلال متزايد,تربيع أول,أحدب متزايد,بدر,أحدب متناقص,تربيع ثانٍ,هلال متناقص',
            cc_ma: 'المغرب', cc_dz: 'الجزائر', cc_tn: 'تونس', cc_eg: 'مصر', cc_sa: 'السعودية', cc_ae: 'الإمارات',
            cc_fr: 'فرنسا', cc_es: 'إسبانيا', cc_be: 'بلجيكا', cc_gb: 'المملكة المتحدة', cc_us: 'الولايات المتحدة',
            ev_newyear: 'رأس السنة الميلادية', ev_nye: 'ليلة رأس السنة', ev_manifesto: 'ذكرى تقديم وثيقة الاستقلال', ev_yennayer: 'رأس السنة الأمازيغية',
            ev_labour: 'عيد الشغل', ev_throne: 'عيد العرش', ev_oued: 'ذكرى استرجاع وادي الذهب', ev_revolution: 'ذكرى ثورة الملك والشعب',
            ev_youth: 'عيد الشباب', ev_unity: 'عيد الوحدة', ev_greenmarch: 'ذكرى المسيرة الخضراء', ev_independence: 'عيد الاستقلال',
            ev_eidfitr: 'عيد الفطر', ev_eidadha: 'عيد الأضحى', ev_hijri: 'رأس السنة الهجرية', ev_mawlid: 'عيد المولد النبوي',
            ev_ramadan: 'رمضان', ev_christmas: 'عيد الميلاد', ev_ucl: 'أمسية دوري أبطال أوروبا', ev_uclfinal: 'نهائي دوري أبطال أوروبا',
            ev_worldcup: 'كأس العالم', ev_afcon: 'كأس أمم أفريقيا', ev_morocco: 'المغرب يلعب اليوم',
            evg_eid: 'عيد مبارك', evg_ramadan: 'رمضان كريم', evg_newyear: 'سنة سعيدة',
            evPrivacy: 'خلفية الأعياد والمناسبات: تأتي العطل الرسمية من تقويم Google (google.com) ومباريات كرة القدم من ESPN (espn.com)؛ لا يُرسل أي شيء عنك. تستخدم خلفية الطقس المباشر خدمة الطقس أدناه. اختر خلفية أخرى لإيقاف ذلك.'
        }
    };
    // Privacy & security: this line goes first (keep it true when the backgrounds change)
    for (var l in S) {
        var p = I18n.raw(l, 'privacyText');
        if (p && p.length !== undefined) S[l].privacyText = [S[l].evPrivacy].concat(p);
    }
    I18n.add(S);
})();
