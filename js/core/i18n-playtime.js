/* Strings of the Playtime app (js/launcher/apps/playtime.js), in the 4 languages. The units (wgH, wgMin) and "This week"
 * (wgWeek) come from js/core/i18n-widgets.js, so the app and the Playtime widget say the same thing. */
(function () {
    'use strict';
    I18n.add({
        en: {
            playtime: 'Playtime', ptM: 'm', ptToday: 'Today', ptYesterday: 'Yesterday', ptNoneToday: 'Not played yet today',
            ptMore: '%s more than the week before', ptLess: '%s less than the week before', ptSame: 'About the same as the week before',
            ptAvg: 'Daily average', ptPlayedDays: 'Played %a of %b days', ptStreak: 'Streak', ptDay1: '1 day', ptDays: '%n days', ptBestDay: 'Best day: %s',
            pt7: '7 days', pt30: '30 days', ptLast7: 'Last 7 days', ptLast30: 'Last 30 days', ptNothing: 'nothing played',
            ptGames: 'Your games', ptAllTime: 'All time: %s', ptSession1: '1 session', ptSessions: '%n sessions', ptLongest: 'longest %s',
            ptLastOn: 'last played %s', ptGone: 'not installed any more', ptOkPlay: 'OK to play',
            ptEmpty: 'No playtime yet. Open a game and your time shows up here.',
            ptNote: 'Counted only while a game or app is open on screen (not while it is paused). Only for your profile.',
            ptClear: 'Clear my playtime', ptClearText: 'Your playtime and stats are deleted. Other profiles keep theirs.', ptCleared: 'Playtime cleared.'
        },
        fr: {
            playtime: 'Temps de jeu', ptM: 'min', ptToday: 'Aujourd’hui', ptYesterday: 'Hier', ptNoneToday: 'Pas encore joué aujourd’hui',
            ptMore: '%s de plus que la semaine d’avant', ptLess: '%s de moins que la semaine d’avant', ptSame: 'Environ comme la semaine d’avant',
            ptAvg: 'Moyenne par jour', ptPlayedDays: 'Joué %a jours sur %b', ptStreak: 'Série', ptDay1: '1 jour', ptDays: '%n jours', ptBestDay: 'Meilleur jour : %s',
            pt7: '7 jours', pt30: '30 jours', ptLast7: '7 derniers jours', ptLast30: '30 derniers jours', ptNothing: 'aucun jeu',
            ptGames: 'Vos jeux', ptAllTime: 'Au total : %s', ptSession1: '1 partie', ptSessions: '%n parties', ptLongest: 'la plus longue %s',
            ptLastOn: 'dernière fois %s', ptGone: 'n’est plus installé', ptOkPlay: 'OK pour jouer',
            ptEmpty: 'Pas encore de temps de jeu. Ouvrez un jeu et votre temps s’affiche ici.',
            ptNote: 'Compté seulement quand un jeu ou une app est ouvert à l’écran (pas en pause). Seulement pour votre profil.',
            ptClear: 'Effacer mon temps de jeu', ptClearText: 'Votre temps de jeu et vos statistiques sont supprimés. Les autres profils gardent les leurs.', ptCleared: 'Temps de jeu effacé.'
        },
        es: {
            playtime: 'Tiempo de juego', ptM: 'min', ptToday: 'Hoy', ptYesterday: 'Ayer', ptNoneToday: 'Aún no has jugado hoy',
            ptMore: '%s más que la semana anterior', ptLess: '%s menos que la semana anterior', ptSame: 'Más o menos como la semana anterior',
            ptAvg: 'Media diaria', ptPlayedDays: 'Jugado %a de %b días', ptStreak: 'Racha', ptDay1: '1 día', ptDays: '%n días', ptBestDay: 'Mejor día: %s',
            pt7: '7 días', pt30: '30 días', ptLast7: 'Últimos 7 días', ptLast30: 'Últimos 30 días', ptNothing: 'nada jugado',
            ptGames: 'Tus juegos', ptAllTime: 'En total: %s', ptSession1: '1 partida', ptSessions: '%n partidas', ptLongest: 'la más larga %s',
            ptLastOn: 'última vez %s', ptGone: 'ya no está instalado', ptOkPlay: 'OK para jugar',
            ptEmpty: 'Aún no hay tiempo de juego. Abre un juego y tu tiempo aparecerá aquí.',
            ptNote: 'Solo se cuenta mientras un juego o una app está abierto en pantalla (no en pausa). Solo para tu perfil.',
            ptClear: 'Borrar mi tiempo de juego', ptClearText: 'Se borran tu tiempo de juego y tus estadísticas. Los demás perfiles conservan los suyos.', ptCleared: 'Tiempo de juego borrado.'
        },
        ar: {
            playtime: 'وقت اللعب', ptM: 'د', ptToday: 'اليوم', ptYesterday: 'أمس', ptNoneToday: 'لم تلعب اليوم بعد',
            ptMore: '%s أكثر من الأسبوع السابق', ptLess: '%s أقل من الأسبوع السابق', ptSame: 'تقريبًا مثل الأسبوع السابق',
            ptAvg: 'المعدل اليومي', ptPlayedDays: 'لعبت %a من %b أيام', ptStreak: 'أيام متتالية', ptDay1: 'يوم واحد', ptDays: '%n أيام', ptBestDay: 'أفضل يوم: %s',
            pt7: '7 أيام', pt30: '30 يومًا', ptLast7: 'آخر 7 أيام', ptLast30: 'آخر 30 يومًا', ptNothing: 'لا لعب',
            ptGames: 'ألعابك', ptAllTime: 'المجموع: %s', ptSession1: 'جلسة واحدة', ptSessions: '%n جلسات', ptLongest: 'الأطول %s',
            ptLastOn: 'آخر مرة %s', ptGone: 'لم تعد مثبتة', ptOkPlay: 'اضغط OK للعب',
            ptEmpty: 'لا يوجد وقت لعب بعد. افتح لعبة وسيظهر وقتك هنا.',
            ptNote: 'يُحسب فقط عندما تكون لعبة أو تطبيق مفتوحًا على الشاشة (ليس أثناء الإيقاف المؤقت). لملفك الشخصي فقط.',
            ptClear: 'مسح وقت لعبي', ptClearText: 'سيُحذف وقت لعبك وإحصاءاتك. تحتفظ الملفات الشخصية الأخرى بإحصاءاتها.', ptCleared: 'تم مسح وقت اللعب.'
        }
    });
})();
