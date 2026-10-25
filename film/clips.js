// Film Room clip data.
// Times are seconds into the YouTube video. `freeze` defaults to 2s before `end`
// (the shot usually goes up in the last ~1.5s of each clip in these compilations).
// Outcomes come from the broadcast call on each play; timing was read from frames
// and can be off by a beat. Tell Claude "clip 12 freezes too late" to fix one.

window.VIDEOS = {
  brunson_pnr: {
    id: '-4HlK4gqzIE',
    player: 'Jalen Brunson',
    title: '25+ Minutes of Jalen Brunson Pick & Roll Scoring (23-24)',
    source: 'Intuition Hoops',
  },
};

window.SKILLS = {
  ballscreen: 'Ball screen reads',
  midrange: 'Mid-range pull-up',
  stepback: 'Step-back',
  floater: 'Floater / runner',
  finish: 'Finishing vs size',
  three: 'Pull-up three',
  pace: 'Change of pace',
};

// ---- answer choices ----
const OPT = {
  three: 'Pull up for three',
  mid: 'Pull up for a mid-range jumper',
  step: 'Step back into the jumper',
  float: 'Floater / runner over the big',
  rim: 'Keep attacking and finish at the rim',
  reject: 'Reject the screen and go the other way',
  use: 'Use the screen like it was called',
};

// ---- coaching by shot type: what he read, why it works, what you take from it ----
const COACH = {
  mid: {
    read: 'He gets a step on his man off the screen and the help defender stays home. That leaves the pocket between the free-throw line and the big wide open, so he stops and rises.',
    why: 'A two-foot pull-up beats a drive when the big is sitting back in the paint. Brunson stops on a dime (hard last two steps, chest up), so his defender flies past or ends up trailing behind him.',
    forYou: 'This is your shot. You don\'t need to jump high, just stop fast and go straight up. In practice: 1-dribble and 2-dribble pull-ups from both elbows, sprinting into the stop. Count makes out of 10 from each spot.',
  },
  step: {
    read: 'His defender is pressed up on him, either chasing over the screen or after a switch. When a defender is close and leaning forward, the space you need comes from going backward.',
    why: 'Brunson sells the drive first (a hard dribble or shoulder dip toward the rim), then steps back. The defender is still going the wrong way, so the shot goes up with room even though Brunson isn\'t quick.',
    forYou: 'The step-back only works if they believe the drive. Practice: jab or a hard rip toward the rim, then step back. Get the footwork right before you add the shot. Don\'t lean back on the release; land balanced.',
  },
  float: {
    read: 'He beats his man but the big is waiting near the rim. A layup gets blocked, and stopping for a pull-up lets the defender behind him recover. So he takes the in-between shot.',
    why: 'The floater goes up before the big can get there, with high arc off one or two feet from 6-10 feet out. It\'s the main weapon small guards have against shot blockers.',
    forYou: 'You will see big help defenders every game. Practice floaters off one foot and off two feet, from both sides, with a high release over a raised hand or a chair. Aim for the ball to come down soft on the front of the rim.',
  },
  rim: {
    read: 'The big doesn\'t step up or stays too far away, and no help comes in time. With a clear lane, Brunson keeps going all the way to the rim.',
    why: 'He\'s not explosive. He gets to the rim with angles and contact: shoulder into the defender\'s chest, protect the ball with his body, use the glass. Hitting the defender first creates the space he can\'t create by jumping.',
    forYou: 'Body-first finishing is a skill for non-athletic guards. Have a teammate hold a pad or push your shoulder. Finish off two feet with the glass, and practice reverses and inside-hand finishes so the big can\'t time you.',
  },
  three: {
    read: 'His defender goes under the screen, or the big sits deep. Either way there\'s air above the arc, and Brunson takes it instead of driving into traffic.',
    why: 'If a defender goes under, the screen already got you open, so make them pay right away. Taking that shot stretches the defense and opens the drive next time down.',
    forYou: 'Know where your defender is on every screen: over, under or switching. If they go under and you\'re a shooter, get your feet set and shoot it. Practice: come off a screen (or a cone) and shoot a 1-dribble pull-up three.',
  },
  reject: {
    read: 'The defense loads up to take away the screen, with the defender jumping over to that side. Brunson sees it before the screen arrives and goes the other way.',
    why: 'If the defense commits early to one side, the other side is wide open. Rejecting the screen beats the scouting report and gets him to his strong hand.',
    forYou: 'Before every screen, look at your defender\'s feet and hips. If they\'re already sitting on the screen side, go the other way. This is a free advantage that takes no athleticism, just eyes.',
  },
};

function shuffleSeeded(arr, seed) {
  const a = arr.slice();
  let s = seed * 9301 + 49297;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// c(start, end, kind, distractors, extra)
let n = 0;
function c(start, end, kind, distractors, extra = {}) {
  n++;
  const keys = shuffleSeeded([kind].concat(distractors), n);
  const coach = COACH[kind === 'use' ? 'rim' : kind];
  const skills = [].concat({
    mid: ['midrange'], step: ['stepback'], float: ['floater'], rim: ['finish'], three: ['three'], reject: ['pace'],
  }[kind] || []).concat(extra.skills || []);
  return {
    id: 'b' + String(n).padStart(2, '0'),
    num: n,
    video: 'brunson_pnr',
    start, end,
    freeze: extra.freeze ?? +(end - 2).toFixed(1),
    title: `#${n} ${extra.title}`,
    coverage: extra.coverage || 'Pick & roll',
    setup: extra.setup || 'Brunson works off the ball screen. Watch his defender and where the big is.',
    question: extra.question || 'What does he do with it?',
    options: keys.map(k => OPT[k]),
    answer: keys.indexOf(kind),
    read: (extra.call ? `Broadcast call: "${extra.call}". ` : '') + (extra.read || coach.read),
    why: extra.why || coach.why,
    forYou: extra.forYou || coach.forYou,
    skills,
  };
}

window.CLIPS = [
  c(5, 8.8, 'mid', ['rim', 'three'], { title: 'Baseline pull-up', call: 'baseline jumper',
    read: 'He goes baseline off the screen. The baseline cuts the floor in half, and when the help doesn\'t come from the corner, the short baseline pull-up is there.' }),
  c(12, 20.8, 'step', ['rim', 'mid'], { title: 'Step-back after the probe', call: 'steps back' }),
  c(25, 28.8, 'mid', ['float', 'three'], { title: 'Pulls the trigger', call: 'pulls the trigger, connects' }),
  c(71, 77.8, 'rim', ['mid', 'float'], { title: 'Attacks, off the glass', call: 'get into the paint... attacks, off the glass',
    setup: 'Knicks need to get into the paint. Brunson comes off the screen with the lane in front of him.' }),
  c(95, 101.8, 'three', ['rim', 'mid'], { title: 'Three with space', call: 'three, at some space' }),
  c(250, 257.8, 'step', ['rim', 'float'], { title: 'Crossover, step-back, lean', call: 'the crossover, the step back, leans in, puts it up', skills: ['pace'] }),
  c(258, 264.8, 'float', ['mid', 'three'], { title: 'Gets inside, quick shot', call: 'gets inside, quick shot',
    read: 'He gets into the paint, but the big is there. Instead of going all the way into the shot blocker, he gets it up quick before the big can load up.' }),
  c(284, 288.8, 'mid', ['rim', 'step'], { title: 'Looking... pull-up', call: 'looking, pull up jumper' }),
  c(289, 294.8, 'mid', ['float', 'three'], { title: 'Finds room, fires', call: 'finds room, fires' }),
  c(309, 315.8, 'three', ['mid', 'rim'], { title: 'Three over Booker', call: 'against Booker, puts up the three... good',
    coverage: 'Guarded by a wing', setup: 'Devin Booker is the one guarding him on this possession.' }),
  c(316, 323.8, 'mid', ['rim', 'step'], { title: 'Pull-up jumper', call: 'pull up jump shot' }),
  c(324, 329.8, 'rim', ['mid', 'float'], { title: 'Crossover drive', call: 'the crossover, drives in right-handed', skills: ['pace'] }),
  c(446, 451.8, 'mid', ['rim', 'three'], { title: 'Drives, then pulls up', call: 'drives, pulls up, jump shot',
    read: 'He starts the drive, which pulls the defense back toward the paint, then stops short. The drive sets up the pull-up.' }),
  c(587, 592.8, 'mid', ['rim', 'float'], { title: 'Elbow pull-up', call: 'drives on Beasley, pulls up, elbow jumper' }),
  c(631, 639.8, 'rim', ['mid', 'three'], { title: 'Splits the defenders', call: 'splitting defenders, and it\'s good',
    coverage: 'Two on the ball', setup: 'Two defenders come together to stop him at the screen. Watch the gap between them.',
    question: 'Two defenders on him. What\'s the play?',
    read: 'Both defenders step up to the ball but leave a gap between them. Brunson gets low and splits it before they can close it.',
    why: 'When two defenders both come after the ball, there\'s a seam between them and four teammates against three behind it. Splitting with a low, quick dribble beats it without needing speed.',
    forYou: 'Splitting is about timing and staying low, not speed. If the two defenders aren\'t shoulder to shoulder, attack the gap with a low crossover or between-the-legs dribble and protect the ball with your off arm. If they are tight, retreat dribble and pass instead.' }),
  c(678, 683.8, 'rim', ['three', 'mid'], { title: 'Around the screen, left hand', call: 'got around the screen with the left hand',
    read: 'He turns the corner tight off the screen, shoulder close to the screener\'s hip, so his defender can\'t get back in front. He stays on his left hand all the way.' }),
  c(684, 694.8, 'three', ['rim', 'float'], { title: 'Goes under: punish it', call: 'using a Hart screen, goes under', freeze: 691.5,
    coverage: 'Defender under the screen', setup: 'Watch whether his defender goes over or under Hartenstein\'s screen.',
    question: 'His defender went under the screen. What do you do?',
    read: 'His man ducks under the screen. That gives Brunson open space above the screen to shoot before the defender can get back.' }),
  c(722, 728.8, 'float', ['mid', 'rim'], { title: 'Finds room, flips it up', call: 'finds his room, flips it up' }),
  c(729, 735.8, 'step', ['rim', 'three'], { title: 'Nice move, shoots over', call: 'oh, nice move, shoots over',
    read: 'He uses a move to get his defender off balance (going backward or sideways), then rises over the top. The move creates the space, not jumping.' }),
  c(736, 743.8, 'mid', ['rim', 'float'], { title: 'Pull-up jumper', call: 'pull up jumper' }),
  c(744, 752.8, 'rim', ['mid', 'three'], { title: 'Shimmy into the paint', call: 'shimmies into the paint, draws contact', skills: ['pace'],
    read: 'He gets the big to commit with a shimmy (shoulder fake), then goes into the body and draws the foul instead of trying to avoid contact.' }),
  c(826, 832.8, 'float', ['rim', 'three'], { title: '14-foot leaner', call: '14-foot leaner' }),
  c(853, 857.8, 'float', ['rim', 'mid'], { title: 'Long arms, floats it', call: 'long arms guarding Brunson... gets inside, floats it up, shot is good',
    coverage: 'Long defender', setup: 'He\'s guarded by a long, rangy defender. Brunson\'s at a big size disadvantage.' }),
  c(887, 892.8, 'rim', ['mid', 'step'], { title: 'Hesitation, drive, layup', call: 'hesitated, drives in, layup', skills: ['pace'],
    read: 'A hesitation dribble makes his defender stand up and rise out of their stance. Then Brunson goes, and that half-second of standing straight is the whole advantage.',
    forYou: 'Hesitation is the best move for a non-athletic guard: slow, slow, FAST. Practice hesi into a drive where the second step is your fastest step of the play. Watch the defender\'s hips: if they rise, go.' }),
  c(893, 897.8, 'rim', ['mid', 'three'], { title: 'Pump fake, off the glass', call: 'fakes, drives... with the glass', skills: ['pace'] }),
  c(935, 941.8, 'step', ['rim', 'float'], { title: 'Gets the step', call: 'gets the step' }),
  c(996, 1001.8, 'float', ['rim', 'three'], { title: 'Floater\'s up', call: 'the floater\'s up' }),
  c(1002, 1008.8, 'mid', ['rim', 'float'], { title: 'Goes at Nesmith, pulls up', call: 'goes on Nesmith, pulls up' }),
  c(1017, 1023.8, 'float', ['rim', 'mid'], { title: 'Floats it up, good', call: 'floats it up, shot is good' }),
  c(1039, 1044.8, 'float', ['three', 'mid'], { title: 'Searching, flips it up', call: 'searching, flips it up' }),
  c(1102, 1108.8, 'three', ['rim', 'mid'], { title: 'Tough contested three', call: 'tough contested three, makes it look easy' }),
  c(1131, 1136.8, 'three', ['rim', 'float'], { title: 'Brown switches onto him', call: 'Brown switching on Brunson... a three-pointer, puts it in',
    coverage: 'Switch', setup: 'Jaylen Brown switches onto Brunson off the screen. Brown is bigger and longer.',
    question: 'A bigger wing switched onto him. What\'s the play?',
    read: 'After the switch, the bigger defender plays off him to protect against the drive. That cushion gives Brunson room to shoot right away.' }),
  c(1170, 1174.8, 'mid', ['rim', 'three'], { title: 'Hesitation jumper', call: 'the hesitation, jump shot', skills: ['pace'] }),
  c(1189, 1193.8, 'three', ['mid', 'rim'], { title: 'Fires from three', call: 'fires from three' }),
  c(1212, 1215.8, 'mid', ['rim', 'three'], { title: 'The jumper', call: 'the jumper', freeze: 1214 }),
  c(1219, 1224.8, 'float', ['rim', 'mid'], { title: 'Head fake, floater', call: 'head fake, floater, good', skills: ['pace'],
    read: 'A head fake gets the help defender off the ground or leaning. Then he floats it over the top while the defender recovers.' }),
  c(1301, 1308.8, 'mid', ['rim', 'three'], { title: 'Bank shot', call: 'with the bank shot',
    read: 'Pull-up from the angle (the "45"), using the glass. From the wing at mid-range, the bank is a bigger target than the rim.' }),
  c(1309, 1314.8, 'rim', ['mid', 'float'], { title: 'Great move on Green, reverse', call: 'great move on Green, and reverse',
    read: 'Draymond Green is a great help defender. Brunson uses the rim to shield the ball from him and finishes with a reverse on the other side.' }),
  c(1321, 1327.8, 'rim', ['mid', 'three'], { title: 'Attacks him, lays it up', call: 'he just attacked him... in the lane, lays it up' }),
  c(1336, 1341.8, 'float', ['rim', 'three'], { title: 'In the paint, short shot', call: 'gets in the paint, short shot' }),
  c(1375, 1382.8, 'rim', ['mid', 'step'], { title: 'And-one', call: 'and an and-one, that\'s what he does',
    read: 'He drives right into the defender\'s chest instead of going around him, and finishes through the contact for the and-one.' }),
  c(1388, 1395.8, 'step', ['rim', 'mid'], { title: 'Step-back three', call: 'step back three, and it is', skills: ['three'] }),
  c(1404, 1410.8, 'three', ['rim', 'mid'], { title: 'Brunson for three', call: 'Brunson for three' }),
  c(1436, 1440.8, 'float', ['mid', 'three'], { title: 'Drives, flips it up', call: 'drives, flips it up, shot is good' }),
  c(1441, 1447.8, 'rim', ['mid', 'float'], { title: 'Drive to the rim, off the glass', call: 'on the drive to the rim, off the glass' }),
  c(1559, 1565.8, 'three', ['rim', 'mid'], { title: 'Reset, off the screen, fires', call: 'gets to reset here... off the screen, Brunson fires' }),
  c(1585, 1591.8, 'mid', ['rim', 'three'], { title: 'The middy', call: 'Brunson with the mid' }),
  c(1603, 1607.8, 'rim', ['mid', 'three'], { title: 'Gets downhill', call: 'got downhill' }),
  c(1616, 1623.5, 'reject', ['use', 'three'], { title: 'Rejects the screen', freeze: 1617.5,
    call: 'rejects the screen, Caruso sticks with him, got to his strong hand',
    coverage: 'Defender jumping the screen', setup: 'The screen is coming. Look at where Alex Caruso (elite defender) is standing before it gets there.',
    question: 'Screen\'s coming. What\'s the read?' }),
];
