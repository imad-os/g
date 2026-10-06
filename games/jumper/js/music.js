/* Super Jumper music: original chiptune loops, played by the GameKit synth.
 * Token = one 16th note; "C5:4" holds 4 steps, ".:4" rests 4 steps. */
var SONGS = {
    map: { bpm: 112, tracks: [
        { wave: 'square', vol: 0.09, notes: 'C5:2 E5:2 G5:4 A5:2 G5:2 E5:4 F5:2 A5:2 G5:4 E5:2 D5:2 C5:4 ' +
                                         'D5:2 F5:2 A5:4 B5:2 A5:2 F5:4 E5:2 G5:2 C6:4 B5:2 G5:2 C6:4' },
        { wave: 'triangle', vol: 0.22, notes: 'C3:4 G3:4 C3:4 G3:4 F3:4 C4:4 G3:4 G2:4 D3:4 A3:4 F3:4 C4:4 G3:4 D3:4 C3:4 G3:4' }
    ] },
    grass: { bpm: 140, tracks: [
        { wave: 'square', vol: 0.1, notes: 'E5:2 G5:2 C6:2 .:2 B5:2 G5:2 A5:4 G5:2 E5:2 F5:2 D5:2 E5:4 .:4 ' +
                                        'C5:2 E5:2 G5:2 .:2 A5:2 G5:2 E5:2 C5:2 D5:2 E5:2 F5:2 D5:2 C5:4 .:4 ' +
                                        'A5:2 A5:2 G5:2 A5:2 C6:4 A5:4 G5:2 E5:2 D5:2 E5:2 G5:4 .:4 ' +
                                        'F5:2 E5:2 D5:2 C5:2 D5:2 E5:2 G5:2 E5:2 D5:4 B4:4 C5:8' },
        { wave: 'triangle', vol: 0.24, notes: 'C3:2 .:2 G3:2 .:2 C3:2 .:2 G3:2 .:2 F2:2 .:2 C3:2 .:2 G2:2 .:2 D3:2 .:2 ' +
                                              'A2:2 .:2 E3:2 .:2 A2:2 .:2 E3:2 .:2 D3:2 .:2 A3:2 .:2 G2:2 .:2 D3:2 .:2 ' +
                                              'F2:2 .:2 C3:2 .:2 F2:2 .:2 C3:2 .:2 C3:2 .:2 G3:2 .:2 C3:2 .:2 G3:2 .:2 ' +
                                              'F2:2 .:2 C3:2 .:2 G2:2 .:2 D3:2 .:2 G2:2 .:2 B2:2 .:2 C3:2 .:2 G2:2 .:2' },
        { drums: 'k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2', vol: 0.7 }
    ] },
    desert: { bpm: 126, tracks: [
        { wave: 'square', vol: 0.1, notes: 'D5:2 E5:2 F5:4 E5:2 D5:2 C#5:4 D5:2 E5:2 A4:4 .:4 ' +
                                        'D5:2 F5:2 A5:4 G5:2 F5:2 E5:4 F5:2 E5:2 D5:4 .:4 ' +
                                        'A5:2 G5:2 F5:2 E5:2 F5:2 E5:2 D5:2 C#5:2 D5:2 E5:2 F5:2 G5:2 A5:4 .:4 ' +
                                        'Bb5:2 A5:2 G5:2 F5:2 E5:2 F5:2 G5:2 E5:2 D5:8 .:8' },
        { wave: 'triangle', vol: 0.24, notes: 'D3:2 A3:2 D3:2 A3:2 D3:2 A3:2 D3:2 A3:2 A2:2 E3:2 A2:2 E3:2 D3:2 A3:2 D3:2 A3:2 ' +
                                              'D3:2 A3:2 D3:2 A3:2 C3:2 G3:2 C3:2 G3:2 Bb2:2 F3:2 Bb2:2 F3:2 A2:2 E3:2 A2:2 E3:2' },
        { drums: 'k:3 h:1 s:2 h:2 k:2 h:2 s:2 k:2', vol: 0.7 }
    ] },
    water: { bpm: 96, tracks: [
        { wave: 'triangle', vol: 0.16, notes: 'E5:6 D5:2 C5:4 E5:4 G5:6 F5:2 E5:8 D5:6 C5:2 B4:4 D5:4 C5:12 .:4' },
        { wave: 'sine', vol: 0.26, notes: 'C3:4 G3:4 E3:4 G3:4 A2:4 E3:4 C3:4 E3:4 F2:4 C3:4 A2:4 C3:4 G2:4 D3:4 C3:8' },
        { wave: 'square', vol: 0.04, notes: 'G5:2 .:6 E5:2 .:6 C6:2 .:6 G5:2 .:6' }
    ] },
    ice: { bpm: 120, tracks: [
        { wave: 'square', vol: 0.08, notes: 'B5:2 .:2 G5:2 .:2 E5:2 .:2 G5:2 B5:2 A5:4 F#5:4 D5:4 .:4 ' +
                                         'G5:2 .:2 E5:2 .:2 C5:2 .:2 E5:2 G5:2 F#5:4 D5:4 B4:4 .:4' },
        { wave: 'triangle', vol: 0.24, notes: 'E3:4 B3:4 E3:4 B3:4 D3:4 A3:4 D3:4 A3:4 C3:4 G3:4 C3:4 G3:4 B2:4 F#3:4 B2:4 F#3:4' },
        { drums: 'k:4 h:2 h:2 s:4 h:2 h:2', vol: 0.5 }
    ] },
    fortress: { bpm: 132, tracks: [
        { wave: 'square', vol: 0.09, notes: 'A4:2 A4:2 C5:2 A4:2 D#5:2 D5:2 C5:2 A4:2 G#4:2 G#4:2 B4:2 G#4:2 D5:2 C5:2 B4:2 G#4:2' },
        { wave: 'triangle', vol: 0.26, notes: 'A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 G#2:2 G#2:2 G#2:2 G#2:2 G#2:2 G#2:2 G#2:2 G#2:2' },
        { drums: 'k:2 k:2 s:2 h:2 k:2 k:2 s:2 s:2', vol: 0.7 }
    ] },
    boss: { bpm: 160, tracks: [
        { wave: 'square', vol: 0.1, notes: 'E5:2 F5:2 E5:2 D#5:2 E5:2 B4:2 C5:2 D5:2 C5:2 B4:2 A4:4 .:4 ' +
                                        'E5:2 G5:2 F#5:2 E5:2 D#5:2 F#5:2 B5:4 A5:2 G5:2 F#5:2 D#5:2 E5:4 .:4' },
        { wave: 'triangle', vol: 0.26, notes: 'E2:2 E3:2 E2:2 E3:2 E2:2 E3:2 E2:2 E3:2 A2:2 A3:2 A2:2 A3:2 B2:2 B3:2 B2:2 B3:2' },
        { drums: 'k:2 s:2 k:2 s:2 k:1 k:1 s:2 k:2 s:2', vol: 0.8 }
    ] },
    star: { bpm: 176, tracks: [
        { wave: 'square', vol: 0.1, notes: 'C5:2 C5:2 E5:2 C5:2 G5:2 C5:2 E5:2 G5:2 D5:2 D5:2 F5:2 D5:2 A5:2 D5:2 F5:2 A5:2' },
        { wave: 'triangle', vol: 0.24, notes: 'C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 D3:2 D4:2 D3:2 D4:2 D3:2 D4:2 D3:2 D4:2' },
        { drums: 'k:2 h:2 s:2 h:2', vol: 0.7 }
    ] },
    clear: { bpm: 150, once: true, tracks: [
        { wave: 'square', vol: 0.12, notes: 'G4:2 C5:2 E5:2 G5:2 C6:4 G5:2 E5:2 A5:2 F5:2 D5:2 B5:2 C6:12 .:4' },
        { wave: 'triangle', vol: 0.24, notes: 'C3:4 E3:4 G3:4 C4:4 F3:4 G3:4 C3:12 .:4' }
    ] },
    gameover: { bpm: 100, once: true, tracks: [
        { wave: 'square', vol: 0.12, notes: 'G4:4 E4:4 C4:4 .:2 A3:2 B3:4 A3:4 G3:8 .:4' },
        { wave: 'triangle', vol: 0.24, notes: 'C3:8 A2:8 F2:8 G2:4 C2:8 .:4' }
    ] }
};
