/* Strings of the Calendar app (js/launcher/apps/calendar.js), its desktop widget and its reminders, in the 4 languages.
 * The holidays' own names come with them (js/core/events.js). */
(function () {
    'use strict';
    var PRIV = {
        en: 'Calendar: the Moroccan holidays and big events come once a day from My PC\'s own website; when that list is old, the TV asks Google Calendar\'s public holiday calendar instead (only your internet address is seen). Football matches come from ESPN (espn.com). Your own events stay in your profile (and its cloud backup).',
        fr: 'Calendrier : les jours fériés du Maroc et les grands événements viennent une fois par jour du site de My PC ; si cette liste est ancienne, la TV interroge le calendrier public des jours fériés de Google Agenda (seule votre adresse internet est vue). Les matchs de football viennent d’ESPN (espn.com). Vos propres événements restent dans votre profil (et sa sauvegarde en ligne).',
        es: 'Calendario: los festivos de Marruecos y los grandes eventos llegan una vez al día desde el sitio de My PC; si esa lista es antigua, la TV consulta el calendario público de festivos de Google Calendar (solo se ve tu dirección de internet). Los partidos de fútbol vienen de ESPN (espn.com). Tus propios eventos se quedan en tu perfil (y su copia en la nube).',
        ar: 'التقويم: تصل العطل المغربية والأحداث الكبرى مرة في اليوم من موقع My PC؛ وإذا كانت القائمة قديمة يسأل التلفاز تقويم العطل العام في تقويم Google (لا يُرى سوى عنوانك على الإنترنت). تأتي مباريات كرة القدم من ESPN (espn.com). تبقى أحداثك الخاصة في ملفك الشخصي (ونسخته الاحتياطية السحابية).'
    };
    var S = {
        en: {
            wg_calendar: 'Calendar', calToday: 'Today', calTomorrow: 'Tomorrow', calNext: 'Next', calInDays: 'in %n days', calNothing: 'No events today or tomorrow',
            calHoliday: 'Public holiday', calObservance: 'Observance', calEvent: 'Event', calMine: 'My event', calExpected: 'expected date',
            calEvents: 'Events', calNoEvents: 'Nothing on this day', calAddEvent: 'Add an event', calEditEvent: 'Edit the event', calNewEvent: 'New event',
            calTitleF: 'Title', calDateF: 'Day', calTime: 'Time', calAllDay: 'All day', calRemind: 'Reminder', calRemindN: 'None', calRemind0: 'At the time',
            calRemind15: '15 minutes before', calRemind60: '1 hour before', calRemind1440: '1 day before', calRepeat: 'Repeat', calOnce: 'Once', calYearly: 'Every year',
            calSave: 'Save', calDelete: 'Delete', calCancel: 'Cancel', calDeleteQ: 'Delete this event?', calSaved: 'Event saved', calNeedTitle: 'Type a title first',
            calReminder: 'Reminder', calTomorrowIs: 'Tomorrow: %s', calTodayIs: 'Today: %s', calHijriAdj: 'Hijri date correction', calDays: '%n day(s)',
            calSrcGoogle: 'Moroccan holidays from Google Calendar', calSrcBuilt: 'Moroccan holidays: expected dates (updated once online)',
            calShowHijri: 'Hijri date', calNotify: 'Tell me the day before', calYes: 'Yes', calNo: 'No', calMore: '+%n more', calRamadan: 'Ramadan',
            calOkHint: 'Press OK to change it', calLess: 'Less', calMoreBtn: 'More'
        },
        fr: {
            wg_calendar: 'Calendrier', calToday: 'Aujourd’hui', calTomorrow: 'Demain', calNext: 'Prochain', calInDays: 'dans %n jours', calNothing: 'Rien aujourd’hui ni demain',
            calHoliday: 'Jour férié', calObservance: 'Célébration', calEvent: 'Événement', calMine: 'Mon événement', calExpected: 'date prévue',
            calEvents: 'Événements', calNoEvents: 'Rien ce jour-là', calAddEvent: 'Ajouter un événement', calEditEvent: 'Modifier l’événement', calNewEvent: 'Nouvel événement',
            calTitleF: 'Titre', calDateF: 'Jour', calTime: 'Heure', calAllDay: 'Toute la journée', calRemind: 'Rappel', calRemindN: 'Aucun', calRemind0: 'À l’heure',
            calRemind15: '15 minutes avant', calRemind60: '1 heure avant', calRemind1440: '1 jour avant', calRepeat: 'Répétition', calOnce: 'Une fois', calYearly: 'Chaque année',
            calSave: 'Enregistrer', calDelete: 'Supprimer', calCancel: 'Annuler', calDeleteQ: 'Supprimer cet événement ?', calSaved: 'Événement enregistré', calNeedTitle: 'Tapez d’abord un titre',
            calReminder: 'Rappel', calTomorrowIs: 'Demain : %s', calTodayIs: 'Aujourd’hui : %s', calHijriAdj: 'Correction de la date hégirienne', calDays: '%n jour(s)',
            calSrcGoogle: 'Jours fériés du Maroc : Google Agenda', calSrcBuilt: 'Jours fériés du Maroc : dates prévues (mises à jour une fois en ligne)',
            calShowHijri: 'Date hégirienne', calNotify: 'Me prévenir la veille', calYes: 'Oui', calNo: 'Non', calMore: '+%n autres', calRamadan: 'Ramadan',
            calOkHint: 'Appuyez sur OK pour modifier', calLess: 'Moins', calMoreBtn: 'Plus'
        },
        es: {
            wg_calendar: 'Calendario', calToday: 'Hoy', calTomorrow: 'Mañana', calNext: 'Próximo', calInDays: 'en %n días', calNothing: 'Nada hoy ni mañana',
            calHoliday: 'Día festivo', calObservance: 'Celebración', calEvent: 'Evento', calMine: 'Mi evento', calExpected: 'fecha prevista',
            calEvents: 'Eventos', calNoEvents: 'Nada este día', calAddEvent: 'Añadir un evento', calEditEvent: 'Editar el evento', calNewEvent: 'Nuevo evento',
            calTitleF: 'Título', calDateF: 'Día', calTime: 'Hora', calAllDay: 'Todo el día', calRemind: 'Aviso', calRemindN: 'Ninguno', calRemind0: 'A la hora',
            calRemind15: '15 minutos antes', calRemind60: '1 hora antes', calRemind1440: '1 día antes', calRepeat: 'Repetir', calOnce: 'Una vez', calYearly: 'Cada año',
            calSave: 'Guardar', calDelete: 'Borrar', calCancel: 'Cancelar', calDeleteQ: '¿Borrar este evento?', calSaved: 'Evento guardado', calNeedTitle: 'Escribe primero un título',
            calReminder: 'Aviso', calTomorrowIs: 'Mañana: %s', calTodayIs: 'Hoy: %s', calHijriAdj: 'Corrección de la fecha de la hégira', calDays: '%n día(s)',
            calSrcGoogle: 'Festivos de Marruecos: Google Calendar', calSrcBuilt: 'Festivos de Marruecos: fechas previstas (se actualizan con internet)',
            calShowHijri: 'Fecha de la hégira', calNotify: 'Avisarme el día antes', calYes: 'Sí', calNo: 'No', calMore: '+%n más', calRamadan: 'Ramadán',
            calOkHint: 'Pulsa OK para cambiarlo', calLess: 'Menos', calMoreBtn: 'Más'
        },
        ar: {
            wg_calendar: 'التقويم', calToday: 'اليوم', calTomorrow: 'غدًا', calNext: 'القادم', calInDays: 'بعد %n أيام', calNothing: 'لا شيء اليوم ولا غدًا',
            calHoliday: 'عطلة رسمية', calObservance: 'مناسبة', calEvent: 'حدث', calMine: 'حدثي', calExpected: 'تاريخ متوقع',
            calEvents: 'الأحداث', calNoEvents: 'لا شيء في هذا اليوم', calAddEvent: 'إضافة حدث', calEditEvent: 'تعديل الحدث', calNewEvent: 'حدث جديد',
            calTitleF: 'العنوان', calDateF: 'اليوم', calTime: 'الوقت', calAllDay: 'طوال اليوم', calRemind: 'تذكير', calRemindN: 'بدون', calRemind0: 'في الوقت نفسه',
            calRemind15: 'قبل 15 دقيقة', calRemind60: 'قبل ساعة', calRemind1440: 'قبل يوم', calRepeat: 'التكرار', calOnce: 'مرة واحدة', calYearly: 'كل سنة',
            calSave: 'حفظ', calDelete: 'حذف', calCancel: 'إلغاء', calDeleteQ: 'حذف هذا الحدث؟', calSaved: 'تم حفظ الحدث', calNeedTitle: 'اكتب العنوان أولًا',
            calReminder: 'تذكير', calTomorrowIs: 'غدًا: %s', calTodayIs: 'اليوم: %s', calHijriAdj: 'تصحيح التاريخ الهجري', calDays: '%n يوم',
            calSrcGoogle: 'العطل المغربية من تقويم Google', calSrcBuilt: 'العطل المغربية: تواريخ متوقعة (تُحدَّث عند الاتصال بالإنترنت)',
            calShowHijri: 'التاريخ الهجري', calNotify: 'نبّهني في اليوم السابق', calYes: 'نعم', calNo: 'لا', calMore: '+%n أخرى', calRamadan: 'رمضان',
            calOkHint: 'اضغط OK للتغيير', calLess: 'أقل', calMoreBtn: 'أكثر'
        }
    };
    // Privacy & security: the calendar's line (keep it true when the calendar changes)
    for (var l in S) {
        S[l].calPrivacy = PRIV[l];
        var p = I18n.raw(l, 'privacyText');
        if (p && p.length !== undefined) S[l].privacyText = p.concat([PRIV[l]]);
    }
    I18n.add(S);
})();
