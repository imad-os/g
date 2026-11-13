/* Strings of the network modes (js/core/netmode.js, the taskbar's Wi-Fi icon) and of rooms on this Wi-Fi (js/core/lan-db.js). */
(function () {
    'use strict';
    I18n.add({
        en: {
            nmTitle: 'Network', nm_online: 'Online', nm_local: 'Home network only', nm_offline: 'No network',
            nmWhy_: 'The whole internet works.', nmWhy_nonet: 'No Wi-Fi or cable connected. Your games keep working offline.',
            nmWhy_noinet: 'Wi-Fi is connected but the internet does not answer.',
            nmWhy_blocked: 'The internet is limited on this Wi-Fi: Facebook and other social sites are blocked.',
            nmWhy_nocloud: 'My PC\'s online services do not answer on this Wi-Fi.',
            nmLocalMp: 'Multiplayer uses rooms on this Wi-Fi (a phone with My PC open hosts them).',
            nmCheck: 'Check the network now', nmChecking: 'Checking the network...',
            nmPref: 'Multiplayer rooms', nmPrefDesc: 'Automatic = on the internet when it works, else on this Wi-Fi. Rooms on this Wi-Fi need a phone with My PC open (or the room hub on a PC).',
            nmPref_auto: 'Automatic', nmPref_lan: 'This Wi-Fi only', nmPref_cloud: 'Internet',
            mpLanNote: 'Home network only: rooms on this Wi-Fi, no internet needed.',
            mpLanLooking: 'Looking for My PC phones on this Wi-Fi...',
            mpErr_nohub: 'No room host on this Wi-Fi. Open My PC on an Android phone on the same Wi-Fi (or the room hub on a PC), then try again.',
            mpErr_lanoff: 'The room host on this Wi-Fi stopped answering.'
        },
        fr: {
            nmTitle: 'Réseau', nm_online: 'En ligne', nm_local: 'Réseau local seulement', nm_offline: 'Pas de réseau',
            nmWhy_: 'Tout internet fonctionne.', nmWhy_nonet: 'Aucun Wi-Fi ni câble connecté. Vos jeux fonctionnent hors ligne.',
            nmWhy_noinet: 'Le Wi-Fi est connecté mais internet ne répond pas.',
            nmWhy_blocked: 'Internet est limité sur ce Wi-Fi : Facebook et d\'autres réseaux sociaux sont bloqués.',
            nmWhy_nocloud: 'Les services en ligne de My PC ne répondent pas sur ce Wi-Fi.',
            nmLocalMp: 'Le multijoueur utilise des salles sur ce Wi-Fi (un téléphone avec My PC ouvert les héberge).',
            nmCheck: 'Vérifier le réseau maintenant', nmChecking: 'Vérification du réseau...',
            nmPref: 'Salles multijoueur', nmPrefDesc: 'Automatique = sur internet quand il fonctionne, sinon sur ce Wi-Fi. Les salles sur ce Wi-Fi demandent un téléphone avec My PC ouvert (ou le relais de salles sur un PC).',
            nmPref_auto: 'Automatique', nmPref_lan: 'Ce Wi-Fi seulement', nmPref_cloud: 'Internet',
            mpLanNote: 'Réseau local seulement : salles sur ce Wi-Fi, pas besoin d\'internet.',
            mpLanLooking: 'Recherche des téléphones My PC sur ce Wi-Fi...',
            mpErr_nohub: 'Aucun hôte de salles sur ce Wi-Fi. Ouvrez My PC sur un téléphone Android connecté au même Wi-Fi (ou le relais sur un PC), puis réessayez.',
            mpErr_lanoff: 'L\'hôte de salles sur ce Wi-Fi ne répond plus.'
        },
        es: {
            nmTitle: 'Red', nm_online: 'En línea', nm_local: 'Solo red local', nm_offline: 'Sin red',
            nmWhy_: 'Todo internet funciona.', nmWhy_nonet: 'Ningún Wi-Fi ni cable conectado. Tus juegos siguen funcionando sin conexión.',
            nmWhy_noinet: 'El Wi-Fi está conectado pero internet no responde.',
            nmWhy_blocked: 'Internet está limitado en este Wi-Fi: Facebook y otras redes sociales están bloqueadas.',
            nmWhy_nocloud: 'Los servicios en línea de My PC no responden en este Wi-Fi.',
            nmLocalMp: 'El multijugador usa salas en este Wi-Fi (un móvil con My PC abierto las aloja).',
            nmCheck: 'Comprobar la red ahora', nmChecking: 'Comprobando la red...',
            nmPref: 'Salas multijugador', nmPrefDesc: 'Automático = en internet cuando funciona, si no en este Wi-Fi. Las salas en este Wi-Fi necesitan un móvil con My PC abierto (o el servidor de salas en un PC).',
            nmPref_auto: 'Automático', nmPref_lan: 'Solo este Wi-Fi', nmPref_cloud: 'Internet',
            mpLanNote: 'Solo red local: salas en este Wi-Fi, sin internet.',
            mpLanLooking: 'Buscando móviles con My PC en este Wi-Fi...',
            mpErr_nohub: 'No hay anfitrión de salas en este Wi-Fi. Abre My PC en un móvil Android en el mismo Wi-Fi (o el servidor en un PC) y vuelve a intentarlo.',
            mpErr_lanoff: 'El anfitrión de salas de este Wi-Fi dejó de responder.'
        },
        ar: {
            nmTitle: 'الشبكة', nm_online: 'متصل بالإنترنت', nm_local: 'الشبكة المحلية فقط', nm_offline: 'لا توجد شبكة',
            nmWhy_: 'الإنترنت كله يعمل.', nmWhy_nonet: 'لا يوجد Wi-Fi أو كابل متصل. ألعابك تعمل بدون اتصال.',
            nmWhy_noinet: 'شبكة Wi-Fi متصلة لكن الإنترنت لا يستجيب.',
            nmWhy_blocked: 'الإنترنت محدود على هذه الشبكة: فيسبوك ومواقع التواصل الأخرى محجوبة.',
            nmWhy_nocloud: 'خدمات My PC على الإنترنت لا تستجيب على هذه الشبكة.',
            nmLocalMp: 'اللعب الجماعي يستخدم غرفاً على هذه الشبكة (يستضيفها هاتف عليه My PC مفتوح).',
            nmCheck: 'فحص الشبكة الآن', nmChecking: 'جارٍ فحص الشبكة...',
            nmPref: 'غرف اللعب الجماعي', nmPrefDesc: 'تلقائي = على الإنترنت عندما يعمل، وإلا على هذه الشبكة. الغرف على هذه الشبكة تحتاج هاتفاً عليه My PC مفتوح (أو خادم الغرف على حاسوب).',
            nmPref_auto: 'تلقائي', nmPref_lan: 'هذه الشبكة فقط', nmPref_cloud: 'الإنترنت',
            mpLanNote: 'الشبكة المحلية فقط: غرف على هذه الشبكة دون إنترنت.',
            mpLanLooking: 'جارٍ البحث عن هواتف My PC على هذه الشبكة...',
            mpErr_nohub: 'لا يوجد مضيف غرف على هذه الشبكة. افتح My PC على هاتف Android متصل بنفس الشبكة (أو خادم الغرف على حاسوب)، ثم حاول مجدداً.',
            mpErr_lanoff: 'توقف مضيف الغرف على هذه الشبكة عن الاستجابة.'
        }
    });
})();
