import { ClientEngine, KeyboardControls, TwoVector } from 'lance-gg';
import SyncClient from '@ircam/sync/client';
import InterferenceRenderer from '../client/InterferenceRenderer';
import Note from '../common/Note';
import Performer from '../common/Performer';
import Egg from '../common/Egg';
import { Transport, Frequency, Sequence, Synth, MonoSynth, PolySynth, NoiseSynth, FMSynth, AMSynth } from 'tone';
import { Reverb, Distortion, Volume } from 'tone';

export default class InterferenceClientEngine extends ClientEngine {

    ///////////////////////////////////////////////////////////////////////////////////////////
    /// INITIALIZATION AND CONNECTION
    constructor(gameEngine, options) {
        super(gameEngine, options, InterferenceRenderer);

        this.syncClient = null;
        this.transportSyncCount = 0;
        this.transport = Transport;
        this.room = null;
        this.player = null;
        this.players = [];
        this.eggs = [];
        this.eggSynths = {};
        this.performanceView = false;
        this.viewLock = false;
        this.controls = new KeyboardControls(this);
        this.prevStage = 'setup';
        this.fullscreen = false;
        this.optionSelection = {};
        this.localControls = {
            //'Backquote': 'ToggleTransport',
            'KeyF': 'ToggleFullscreen',
            'KeyH': 'ToggleCursor',
            'KeyV': 'ToggleView',
            'Slash': 'ToggleLock',
            'KeyX': 'ToggleEndGameControl'
        };
        this.melodyStep = 0;
        this.bassStep = 0;
        this.percStep = 0;
        this.sequences = {};
        this.pitchSet = 'scale';

        this.gameEngine.on('client__preStep', this.preStepLogic.bind(this));
        this.gameEngine.on('client__postStep', this.postStepLogic.bind(this));
        this.gameEngine.on('updatePalette', () => { this.onUpdatePalette() });
        this.gameEngine.on('eggBounce', e => { this.onEggBounce(e) });
        this.gameEngine.on('playerHitEgg', e => { this.onPlayerHitEgg(e) });
        this.gameEngine.on('eggBroke', e => { this.onEggBroke(e) });
    }

    executeLocalControl(controlString) {
        if (controlString === 'ToggleTransport') {
            if (this.transport.state !== 'started') {
                this.transport.start('+0.1');
                this.transport.seconds = this.syncClient.getSyncTime();
            }   
            else {
                this.transport.pause();
            }
        }
        else if (controlString === 'ToggleFullscreen') {
            if (!this.viewLock) {
                let elem = this.renderer.canvas;
                if (!document.fullscreenElement) {
                    elem.requestFullscreen({navigationUI: 'hide'}).then({}).catch(err => {
                        //alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
                    });
                    this.renderer.setRendererSize();
                } else {
                    document.exitFullscreen();
                    this.renderer.setRendererSize();
                }
            }
        }
        else if (controlString === 'ToggleCursor') {
            if (!this.viewLock) {
                if (document.pointerLockElement === document.body || 
                    document.mozPointerLockElement === document.body) {
                    document.exitPointerLock();
                } else {
                    document.body.requestPointerLock();
                }
            }
        }
        else if (controlString === 'ToggleView') {
            //console.log('view');
            if (!this.viewLock) this.performanceView = !this.performanceView;
        }
        else if (controlString === 'ToggleLock') {
            //console.log('lock');
            this.viewLock = !this.viewLock;
        }
        else if (controlString === 'ToggleEndGameControl') {
            this.optionSelection['KeyO'] = 'endGame';
            setTimeout(() => { 
                if (this.optionSelection['KeyO'] != null) delete this.optionSelection['KeyO'];
            }, 1000);
        }
    }

    executeOption(optionString) {
        if (optionString === 'build') {
            this.socket.emit('startBuildStage');
            this.optionSelection = {};
        }
        else if (optionString === 'fight') {
            this.socket.emit('startFightStage');
            this.optionSelection = {};
        }
        // else if (optionString === 'faster') {
        //     this.socket.emit('changeTempo', 20);
        //     this.optionSelection = {};
        // }
        // else if (optionString === 'slower') {
        //     this.socket.emit('changeTempo', -20);
        //     this.optionSelection = {}; 
        // }
        else if (optionString === 'endGame') {
            this.socket.emit('endGame');
            delete this.optionSelection['KeyO'];
        }
    }

    start() {
        super.start()

        let btn = document.getElementById('startButton');
        let roomNameInput = document.getElementById('roomNameInput');
        let errorText = document.querySelector('#startMenu .room-error');

        btn.onclick = () => {
            let regex = /^\w+$/;
            if (regex.exec(roomNameInput.value) != null) {
                this.assignToRoom(roomNameInput.value.substring(0, 20));
            } else {
                errorText.textContent = 
                'Room name can only contain alphanumeric characters or underscores and must be at least 1 character long.';
            }
        };

        document.body.requestPointerLock = document.body.requestPointerLock || document.body.mozRequestPointerLock;

        // LOCAL CONTROLS
        // Any inputs that do nothing server-side (i.e. doesn't need to be known by other players)
        document.addEventListener('keypress', e => {
            //console.log(e.code);
            if (document.activeElement === roomNameInput) {
                if (e.code === 'Enter') {
                    let regex = /^\w+$/;
                    if (regex.exec(roomNameInput.value) != null) {
                        this.assignToRoom(roomNameInput.value.substring(0, 20));
                    } else {
                        errorText.textContent = 
                        'Room name can only contain alphanumeric characters or underscores and must be at least 1 character long.';
                    }
                }
            }
            else {
                if (this.optionSelection[e.code]) {
                    this.executeOption(this.optionSelection[e.code]);
                }
                if (this.localControls[e.code]) {
                    this.executeLocalControl(this.localControls[e.code]);
                }
            }
        });
    }

    connect(options = {}) {
        return super.connect().then(() => {
            this.socket.on('assignedRoom', roomName => { 
                document.getElementById('startMenuWrapper').style.display = 'none';
                // NETWORKED CONTROLS
                // These inputs will also be processed on the server
                //console.log('binding keys');
                //this.controls.bindKey('space', 'space');
                this.controls.bindKey('open bracket', '[');
                this.controls.bindKey('close bracket / å', ']');
                this.controls.bindKey('n', 'n');
                this.controls.bindKey('b', 'b'); // begin
                this.controls.bindKey('c', 'c'); // change color
                this.controls.bindKey('space', 'space');
                this.controls.bindKey('q', 'q');
                this.controls.bindKey('w', 'w');
                this.controls.bindKey('e', 'e');
                this.controls.bindKey('a', 'a');
                this.controls.bindKey('s', 's');
                this.controls.bindKey('d', 'd');
                this.controls.bindKey('p', 'p');
                this.controls.bindKey('back slash', 'back slash');
                this.startSyncClient(this.socket);
                this.room = roomName;
                this.transport.start('+0.1');
            });
            this.socket.on('accessDenied', () => {
                let errorText = document.querySelector('#startMenu .room-error');
                errorText.textContent = 
                'Cannot join room. Performance in progress.';
            });
            this.socket.on('changeTempo', bpm => {
                this.transport.scheduleOnce(() => {
                    this.transport.bpm.value = bpm;
                }, this.nextDiv('1m'));
            });
        });
    }

    startSyncClient(socket) {
        const startTime = performance.now();
        this.syncClient = new SyncClient(() => { return (performance.now() - startTime) / 1000 });
        this.syncClient.start(
            // send function
            (pingId, clientPingTime) => {
                var request = [];
                request[0] = 0; // we send a ping
                request[1] = pingId;
                request[2] = clientPingTime;

                //console.log('[ping] - id: %s, pingTime: %s', request[1], request[2]);

                this.socket.emit('syncClientData', request);
            },       
            // receive function  
            callback => {
                // unpack args before executing the callback
                this.socket.on('syncServerData', function (data) {
                    var response = data;

                    if (response[0] === 1) { // this is a pong
                        var pingId = response[1];
                        var clientPingTime = response[2];
                        var serverPingTime = response[3];
                        var serverPongTime = response[4];

                        //console.log('[pong] - id: %s, clientPingTime: %s, serverPingTime: %s, serverPongTime: %s',
                        //pingId, clientPingTime, serverPingTime, serverPongTime);

                        callback(pingId, clientPingTime, serverPingTime, serverPongTime);
                    }
                });
            }, 
            // status report function
            status => { }//console.log(status); }
        );
    }

    assignToRoom(roomName) {
        if (this.socket) {
            this.socket.emit('assignToRoom', roomName);
        }
    } 

    ///////////////////////////////////////////////////////////////////////////////////////////
    /// SOUND HANDLING AND CLIENT LOGIC

    /// STEP
    preStepLogic() {
        if (this.room == null) return; //if we've yet to be assigned a room, don't do this stuff

        if (this.transport.state === 'started') {
            if (this.transportSyncCount >= this.gameEngine.transportSyncInterval) {
                this.transport.seconds = this.syncClient.getSyncTime();
                this.transportSyncCount = 0;
                //console.log(client.transport.state);
            }
            this.transportSyncCount++;
        }

        this.player = this.gameEngine.world.queryObject({ playerId: this.gameEngine.playerId });
    }

    postStepLogic() {
        if (this.room == null) return; //if we've yet to be assigned a room, don't do this stuff
        if (this.player == null) return;
        if (this.reverb == null && this.player.palette != 0) this.initSound();

        console.log(`grid=${this.player.grid}`);

        this.players = this.gameEngine.playersByRoom[this.player._roomName];//this.gameEngine.world.queryObjects({ instanceType: Performer });

        this.eggs = this.gameEngine.world.queryObjects({ instanceType: Egg });

        let stage = this.player.stage;

        this.pitchSet = this.player.pitchSet;

        this.sequences = {};
        for (let note of this.gameEngine.world.queryObjects({ instanceType: Note })) {
            if (note.id >= this.gameEngine.options.clientIDSpace) {
                let serverCopy = this.gameEngine.resolveShadowObject(note);
                if (serverCopy != null) {
                    serverCopy.animFrame = note.animFrame;
                }
            }
            let pal = this.gameEngine.paletteAttributes[note.palette];
            note.step = note.xPos % pal.gridWidth;
            note.pitch = (pal.gridHeight - note.yPos) + (pal.pitchSets[this.pitchSet].length * 3);
            let number = Math.floor(note.xPos / pal.gridWidth);
            if (this.sequences[number] == null) this.sequences[number] = {};
            if (this.sequences[number][note.sound] == null) this.sequences[number][note.sound] = [];
            if (this.sequences[number][note.sound][note.step] == null) this.sequences[number][note.sound][note.step] = [];
            this.sequences[number][note.sound][note.step].push(note);
        }
        //console.log(this.pitchSet);

        if (stage === 'setup') {

        }
        else {
            if (this.transport.state !== 'started') {// && this.prevStage !== stage) {
                this.transport.start('+1');
                this.transport.seconds = this.syncClient.getSyncTime();
            }
            if (this.melodySequence.state !== 'started') {
                //console.log('start seq');
                this.melodySequence.start(this.nextDiv('1m'));
            }
            if (this.bassSequence.state !== 'started') {
                //console.log('start seq');
                this.bassSequence.start(this.nextDiv('4m'));
            }
            if (this.percSequence.state !== 'started') {
                //console.log('start seq');
                this.percSequence.start(this.nextDiv('2m'));
            }
        }
        if (stage == 'build') {
            for (let e of this.eggs) {
                if (!Object.keys(this.eggSynths).includes(e.toString())) this.constructEggSynths(e);
                let vol = -(12 * Math.abs(this.player.number - Math.floor(e.position.x / this.gameEngine.playerWidth)));
                this.eggSynths[e.toString()].drone.volume.value = vol;
                let pal = this.gameEngine.paletteAttributes[this.player.palette];
                let pitch = pal.scale[pal.pitchSets[this.pitchSet][0]];
                if (e.sound === 'melody') {
                    this.eggSynths[e.toString()].drone.setNote(Frequency(pitch + 72, 'midi'));
                }
                else if (e.sound === 'bass') {
                    this.eggSynths[e.toString()].drone.setNote(Frequency(pitch + 36, 'midi'));
                }
            }
        }
        if (stage == 'outro') {
            this.eggVolume.mute = true;
        }
        this.prevStage = stage;
    }

    /// GAME EVENTS

    onUpdatePalette() {
        let palettes = this.gameEngine.palettes;
        this.player.palette = palettes[(palettes.indexOf(this.player.palette) + 1) % palettes.length];
        this.socket.emit('updatePalette', this.player.palette);
        this.player.grid.fill(this.player.palette);
        console.log(this.player.grid);
    }

    onEggBounce(e) {
        if (!Object.keys(this.eggSynths).includes(e.toString())) this.constructEggSynths(e);
        if (this.gameEngine.positionIsInPlayer(e.position.x, this.player)) {
            let pal = this.gameEngine.paletteAttributes[this.player.palette];
            let scale = pal.scale;
            let chord = pal.pitchSets[this.pitchSet];
            let pitch = Math.floor(Math.random() * chord.length);
            if (e.sound === 'melody') {
                this.playPitchOnSynth(this.eggSynths[e.toString()].bounce, pitch, chord, scale, 6, '16n', '+0.01', 0.7);
            }
            else if (e.sound === 'bass') {
                this.playPitchOnSynth(this.eggSynths[e.toString()].bounce, pitch, chord, scale, 4, '16n', '+0.01', 0.7);
            }
            else if (e.sound === 'perc') {
                this.eggSynths[e.toString()].bounce.triggerAttackRelease('16n', '+0.01', 0.2);
            }
        }
    }

    onPlayerHitEgg(e) {
        let p = this.player;
        if (e.hp <= 0) return;
        if (p.ammo <= 0) return;
        p.ammo--;
        e.hp--;

        let pal = this.gameEngine.paletteAttributes[p.palette];
        let shadowId = this.gameEngine.getNewShadowId();
        this.socket.emit('playerHitEgg', p.ammo, e.id, e.hp, e.position.x, e.position.y, e.sound, shadowId);
        let pos = this.gameEngine.quantizedPosition(e.position.x, e.position.y, pal.gridWidth, pal.gridHeight);
        let dur = pal[e.sound].subdivision;

        let notes = this.gameEngine.queryNotes({            
            ownerId: p.playerId, 
            palette: p.grid[pos[0]%pal.gridWidth + ((pos[1]%pal.gridHeight) * pal.gridWidth)],
            sound: e.sound, 
            //vel: 1, 
            xPos: pos[0],
            yPos: pos[1]
        });
        if (notes.length) notes[0].dur = '2n';
        else {
            let newNote = new Note(this.gameEngine, null, { 
                id: shadowId,
                ownerId: p.playerId, 
                palette: p.grid[pos[0]%pal.gridWidth + ((pos[1]%pal.gridHeight) * pal.gridWidth)],
                sound: e.sound, 
                dur: dur,
                vel: 1, 
                xPos: pos[0],
                yPos: pos[1],
                position: new TwoVector(pos[0], pos[1])
            });
            newNote.inputId = shadowId;
            this.gameEngine.addObjectToWorld(newNote);
        }
    }

    onEggBroke(e) {
        if (this.eggSynths == null) return;
        if (this.eggSynths[e.toString()] == null) return;
        //console.log('egg broke');
        this.eggSynths[e.toString()].drone.triggerRelease();
        if (this.gameEngine.positionIsInPlayer(e.position.x, this.player)) {
            this.eggSynths[e.toString()].break.start(this.nextDiv('4n'));
            this.optionSelection['Digit1'] = 'build';
            this.optionSelection['Digit2'] = 'fight';
            // this.optionSelection['Digit3'] = 'faster';
            // this.optionSelection['Digit4'] = 'slower';
            this.optionSelection['Numpad1'] = 'build';
            this.optionSelection['Numpad2'] = 'fight';
            // this.optionSelection['Numpad3'] = 'faster';
            // this.optionSelection['Numpad4'] = 'slower';
        }
    }

    //// SOUND

    initSound() {

        //this.transport.timeSignature = 4;

        this.reverb = new Reverb(2).toMaster();
        this.distVolume = new Volume(-12).toMaster();
        this.distVolume.connect(this.reverb);
        this.distortion = new Distortion(1).connect(this.distVolume);
        //this.bitcrusher = new BitCrusher(4).connect(this.reverb); 
        this.reverb.generate();

        this.eggVolume = new Volume(0).toMaster();
        this.eggVolume.connect(this.reverb);
        //this.bitcrusher.start();
        /*
        this.synth = new Synth({
            oscillator: {
                type: 'sine',
            },
            envelope: {
                attack: 0,
                decay: 0.1,
                sustain: 0,
                release: 0.1,
            }
        }).toMaster();
        */
        let pal = this.gameEngine.paletteAttributes[this.player.palette];

        let events = [];
        for (let i = 0; i < pal.gridWidth; i++) {
           events.push(i);
        }

        // One possible way to sequence chords
        // let progression = [];
        // for (let i = 0; i < pal.pitchSets.length - 1; i++) {
        //    events.push(i);
        // }

        // this.harmonySequencer = new Sequence((time, step) => {
        //     this.pitchSet = pal.pitchSets[step];
        // }, progression, '2m');

        this.melodySynth = new PolySynth(pal.gridHeight, FMSynth, {
            "modulationIndex" : 4,
            "harmonicity": 4,
            "oscillator": {
                "type" : "sawtooth",
                "partials" : [0, 1, 2, 3]
            },
            "envelope" : {
                "attack" : 0.01,
                "decay" : 0.1,
                "sustain": 0.2
            },
            "modulation" : {
                "type" : "sine"
            },
            "modulationEnvelope" : {
                "attack" : 0.03,
                "decay" : 0.7
            }
        }).toMaster();
        this.melodySynth.connect(this.reverb);

        this.melodySequence = new Sequence((time, step) => {
            this.melodyStep = step;
            if (this.sequences[this.player.number] == null) return;
            if (this.sequences[this.player.number].melody == null) return;
            let seqStep = this.sequences[this.player.number].melody[this.melodyStep];
            if (seqStep) this.playNoteArrayOnSynth(this.melodySynth, seqStep, 0, time, true);
        }, events, pal.melody.subdivision);


        this.bassSynth = new PolySynth(pal.gridHeight, FMSynth, {
            "modulationIndex" : 6,
            "harmonicity": 5,
            "oscillator": {
                "type" : "triangle",
            },
            "envelope" : {
                "attack" : 0.01,
                "decay" : 0.1,
                "sustain": 0.5
            },
            "modulation" : {
                "type" : "sine"
            },
            "modulationEnvelope" : {
                "attack" : 0.01,
                "decay" : 0.07
            }
        }).toMaster();
        this.bassSynth.connect(this.reverb);

        this.bassSequence = new Sequence((time, step) => {
            this.bassStep = step; 
            if (this.sequences[this.player.number] == null) return;
            if (this.sequences[this.player.number].bass == null) return;
            let seqStep = this.sequences[this.player.number].bass[this.bassStep];
            if (seqStep) this.playNoteArrayOnSynth(this.bassSynth, seqStep, -2, time, true);       
        }, events, pal.bass.subdivision);


        this.percSynth = new PolySynth(pal.gridHeight, FMSynth, {
            "modulationIndex" : 40,
            "harmonicity": 0.01,
            "envelope" : {
                "attack" : 0.01,
                "decay" : 0.01,
                "sustain": 0.05
            },
            "modulation" : {
                "type" : "square"
            },
            "modulationEnvelope" : {
                "attack" : 0.01,
                "decay" : 0.07
            }
        });//.toMaster();
        this.percSynth.connect(this.distortion);

        this.percSequence = new Sequence((time, step) => {
            this.percStep = step;
            if (this.sequences[this.player.number] == null) return;
            if (this.sequences[this.player.number].perc == null) return;
            let seqStep = this.sequences[this.player.number].perc[this.percStep];
            if (seqStep) this.playNoteArrayOnSynth(this.percSynth, seqStep, -1, time, true);
        }, events, pal.perc.subdivision);
    }

    constructEggSynths(e) {
        if (this.player == null) return;

        let pal = this.gameEngine.paletteAttributes[this.player.palette];

        if (e.sound === 'melody') {
            let synth = new Synth({
                oscillator: {
                    type: 'triangle',
                },
                envelope: {
                    attack: 0.005,
                    decay: 0.5,
                    sustain: 0,
                    release: 0.1,
                }
            });
            this.eggSynths[e.toString()] = {
                drone: new FMSynth({
                    "modulationIndex" : 4,
                    "harmonicity": 4,
                    "oscillator": {
                        "type" : "sawtooth2",
                    },
                    "envelope" : {
                        "attack" : 0.5,
                        "decay" : 0.1,
                        "sustain": 0.5
                    },
                    "modulation" : {
                        "type" : "sine"
                    },
                    "modulationEnvelope" : {
                        "attack" : 0.03,
                        "decay" : 0.7,
                        "sustain" : 0.5
                    }
                }).connect(this.eggVolume),
                bounce: new FMSynth({
                    "modulationIndex" : 4,
                    "harmonicity": 4,
                    "oscillator": {
                        "type" : "sawtooth4",
                    },
                    "envelope" : {
                        "attack" : 0.01,
                        "decay" : 0.1,
                    },
                    "modulation" : {
                        "type" : "sine"
                    },
                    "modulationEnvelope" : {
                        "attack" : 0.03,
                        "decay" : 0.7
                    }
                }).connect(this.eggVolume),
                breakSynth: synth.connect(this.eggVolume), 
                break: new Sequence((time, pitch) => {
                    let scale = pal.scale;
                    let chord = pal.pitchSets[this.pitchSet];
                    this.playPitchOnSynth(synth, pitch, chord, scale, 6, '64n', time, 0.1);
                }, [[4, 2, 3, 1, 3, 1, 2, 0], null, null, null], '4n')
            };
        }
        else if (e.sound === 'bass') {
            let synth = new Synth({
                oscillator: {
                    type: 'triangle',
                },
                envelope: {
                    attack: 0.005,
                    decay: 0.5,
                    sustain: 0,
                    release: 0.1,
                }
            });
            this.eggSynths[e.toString()] = {
                drone: new FMSynth({
                    "modulationIndex" : 4,
                    "harmonicity": 5,
                    "oscillator": {
                        "type" : "sawtooth2",
                    },
                    "envelope" : {
                        "attack" : 0.5,
                        "decay" : 0.28,
                        "sustain": 0.5
                    },
                    "modulation" : {
                        "type" : "square"
                    },
                    "modulationEnvelope" : {
                        "attack" : 0.5,
                        "decay" : 0.06, 
                        "sustain" : 0.5
                    }
                }).connect(this.eggVolume),
                bounce: new FMSynth({
                    "modulationIndex" : 6,
                    "harmonicity": 1.5,
                    "oscillator": {
                        "type" : "sawtooth4",
                    },
                    "envelope" : {
                        "attack" : 0.01,
                        "decay" : 0.28,
                        "sustain": 0.0
                    },
                    "modulation" : {
                        "type" : "square"
                    },
                    "modulationEnvelope" : {
                        "attack" : 0.01,
                        "decay" : 0.06
                    }
                }).connect(this.eggVolume),
                breakSynth: synth.connect(this.eggVolume), 
                break: new Sequence((time, pitch) => {
                    let scale = pal.scale;
                    let chord = pal.pitchSets[this.pitchSet];
                    this.playPitchOnSynth(synth, pitch, chord, scale, 6, '64n', time, 0.1);
                }, [[0, 1, 2, 3, 1, 2, 3, 4], null, null, null], '4n')
            };
        }
        else if (e.sound === 'perc') {
            let synth = new Synth({
                oscillator: {
                    type: 'triangle',
                },
                envelope: {
                    attack: 0.005,
                    decay: 0.5,
                    sustain: 0,
                    release: 0.1,
                }
            });
            this.eggSynths[e.toString()] = {
                drone: new NoiseSynth({
                    noise: {
                        type: 'pink',
                    },
                    envelope: {
                        attack: 1,
                        decay: 0.1,
                        sustain: 1,
                        release: 0.5,
                    }
                }).connect(this.eggVolume),
                bounce: new NoiseSynth({
                    noise: {
                        type: 'pink',
                    },
                    envelope: {
                        attack: 0.01,
                        decay: 0.3,
                        sustain: 0.1,
                        release: 0.5,
                    }
                }).connect(this.eggVolume),
                breakSynth: synth.connect(this.eggVolume), 
                break: new Sequence((time, pitch) => {
                    let scale = pal.scale;
                    let chord = pal.pitchSets[this.pitchSet];
                    this.playPitchOnSynth(synth, pitch, chord, scale, 6, '64n', time, 0.1);
                }, [[0, 4, null, null, null, null, 1, 5], null, null, null], '4n')
            };
        }

        let pitch = pal.scale[pal.pitchSets[this.pitchSet][0]];
        if (e.sound === 'melody') {
            this.eggSynths[e.toString()].drone.triggerAttack(Frequency(pitch + 72, 'midi'), '+0.01', 0.2);
        }
        else if (e.sound === 'bass') {
            this.eggSynths[e.toString()].drone.triggerAttack(Frequency(pitch + 36, 'midi'), '+0.01', 0.3);    
        }
        else if (e.sound === 'perc') {
            this.eggSynths[e.toString()].drone.triggerAttack('+0.01', 0.02);
        }
        this.eggSynths[e.toString()].break.loop = 4;
    }

    playPitchOnSynth(synth, pitch, chord, scale, octaveShift, dur, time, vel) {
        let degree = pitch % chord.length;
        let octave = Math.floor(pitch / chord.length) + octaveShift;
        let midi = Frequency(scale[chord[degree]] + (12 * octave), 'midi');
        synth.triggerAttackRelease(midi, dur, time, vel);
    }

    playNoteArrayOnSynth(synth, noteArray, octaveShift, time) {
        if (!noteArray) return;
        let idArray = [];
        let pitchArray = [];
        for (let note of noteArray) {
            let pal = this.gameEngine.paletteAttributes[note.palette];
            if (!pitchArray.includes(note.pitch)) {
                this.playPitchOnSynth(synth, note.pitch, pal.pitchSets[this.pitchSet], pal.scale, octaveShift, note.dur, time, note.vel);
            }
            idArray.push(note.id);
            pitchArray.push(note.pitch)
            //note.paint();
        }

        //this.socket.emit('paintStep', idArray);
    }

    paintNote(n) {
        n.paint();
        this.socket.emit('paintCell', n.id, n.xPos, n.yPos, n.palette);
    }

    nextDiv(div) {
        return Transport.getSecondsAtTime(Transport.nextSubdivision(div));
    }
}
