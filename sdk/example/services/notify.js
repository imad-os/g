// Example push notification service (sdk/GUIDE.md section 16). To use it, add to mypc-app.json:
//   "services": [{ "id": "daily", "file": "services/notify.js", "every": 30, "title": "Daily challenge" }]
// Once a day it tells every player who allowed notifications that a new challenge is ready.
export default async function (ctx) {
  const day = new Date(ctx.now).toISOString().slice(0, 10);          // '2026-11-04'
  if (ctx.state && ctx.state.day === day) return { notifications: [], state: ctx.state };   // already sent today
  return {
    notifications: [{
      username: '*',
      title: 'New daily challenge',
      message: 'Catch 50 stars without touching a rock. Today only!',
      link: 'star-catcher:challenge/' + day      // deep link: opens Star Catcher, MyPC.launch.path = 'challenge/2026-11-04'
    }],
    state: { day }
  };
}
