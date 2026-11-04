// A desktop widget for Star Catcher (sdk/GUIDE.md section 18). It runs in a Web Worker on the TV, once per refresh:
// no page, no DOM, no MyPC object. It returns what to show; My PC draws the card.
export default async function (ctx) {
  // ctx.settings  this profile's choices for the settings in mypc-app.json ({ goal: '50', tips: true })
  // ctx.state     what the last run returned as state (null the first time); ctx.action: the button pressed, or null
  const st = ctx.state || { caught: 0 };
  if (ctx.action === 'add') st.caught += 1;           // the "+1" button
  if (ctx.action === 'reset') st.caught = 0;
  const goal = +ctx.settings.goal || 50;
  const hour = new Date(ctx.now).getHours();
  return {
    view: {
      icon: '⭐',                                   // 1 to 4 characters (an emoji), or an https:// picture
      big: st.caught + ' / ' + goal,
      sub: 'stars caught today',
      text: ctx.settings.tips ? (hour < 12 ? 'Morning tip: rocks fall slower early on.' : 'Tip: catch two stars in a row for a bonus.') : '',
      progress: Math.min(1, st.caught / goal),
      buttons: [{ id: 'add', label: '+1' }, { id: 'reset', label: 'Reset' }],
      accent: '#ffc83d',
      link: 'level/' + Math.min(9, 1 + Math.floor(st.caught / 10))   // OK on the card opens the game there (MyPC.launch.path)
    },
    state: st                                            // given back as ctx.state next time (4000 characters of JSON at most)
  };
}
