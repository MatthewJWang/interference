import { Renderer, TwoVector } from 'lance-gg';
import Performer from '../common/Performer';
import Egg from '../common/Egg';
import { Frequency } from 'tone';

const paletteTable = {
    'rain': {   
        bg: '#3e2f5b', 
        c1: '#d7dedc',
        c2: '#706563',
        c3: '#457eac',
        c4: '#748386' 
    },
    'celeste': {   
        bg: '#a5d8ff', 
        c1: '#ff8266',
        c2: '#4381af',
        c3: '#ac86b0',
        c4: '#4b719c' 
    },
    'pyre': {   
        bg: '#a32323', 
        c1: '#2375a8',
        c2: '#fbf6f7',
        c3: '#f0ae62',
        c4: '#011936' 
    },
    'journey': {   
        bg: '#fad68a', 
        c1: '#7f2819',
        c2: '#a25a11',
        c3: '#d5a962',
        c4: '#fef8e8' 
    },
    'kirby': {   
        bg: '#a8c256', 
        c1: '#f4a4a7',
        c2: '#e84c41',
        c3: '#f9df6a',
        c4: '#fa8334' 
    },
    'default': {
        bg: 'black',
        c1: 'white',
        c2: 'white',
        c3: 'white',
        c4: 'white'
    }
}

const animLengths = {
    eggSpawn: 20,
    eggBreak: 30,
    eggNote: 10
}

let transportSyncCount = 0;
let game = null;
let client = null;
let canvas = []
let ctx = [];
let w = 0;
let h = 0;
let leftViewBound = 0; // bounds of area to be rendered in game coordinates
let rightViewBound = 0;
let time = 0;
let players = []; 
let playerId = 0;
let thisPlayer = null;
let graphicNotes = {};
let eggs = [];

let prevNotestack = '';
let prevRhythmstack = '';

let bg = paletteTable['default'].bg;
let c1 = paletteTable['default'].c1;
let c2 = paletteTable['default'].c2;
let c3 = paletteTable['default'].c3;
let c4 = paletteTable['default'].c4;

export default class InterferenceRenderer extends Renderer {

    constructor(gameEngine, clientEngine) {
        super(gameEngine, clientEngine);

        game = this.gameEngine;
        client = this.clientEngine;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');

        canvas[0] = document.createElement('canvas');
        ctx[0] = canvas[0].getContext('2d');
        ctx[0].lineWidth = 1;

        canvas[1] = document.createElement('canvas');
        ctx[1] = canvas[1].getContext('2d');
        ctx[1].lineWidth = 1;

        w = canvas[0].width = canvas[1].width = this.canvas.width = window.innerWidth;
        h = canvas[0].height = canvas[1].height = this.canvas.height = window.innerHeight;

        document.body.insertBefore(this.canvas, document.getElementById('logo'));

        window.addEventListener('resize', ()=>{ this.setRendererSize(); });
    }

    draw(t, dt) {
        super.draw(t, dt);

        if (client.room === null) return

        time = client.syncClient.getSyncTime();
        playerId = game.playerId;
        thisPlayer = game.world.queryObject({ playerId });
        if (client.performanceView) {
            players = [thisPlayer];
            leftViewBound = thisPlayer.number * game.playerWidth;
            rightViewBound = (thisPlayer.number + 1) * game.playerWidth;
        }
        else {
            players = game.world.queryObjects({ instanceType: Performer });
            leftViewBound = 0;
            rightViewBound = players.length * game.playerWidth;
        }

        graphicNotes = client.graphicNotes;
        eggs = game.world.queryObjects({ instanceType: Egg });

        bg = paletteTable[thisPlayer.palette].bg;
        c1 = paletteTable[thisPlayer.palette].c1;
        c2 = paletteTable[thisPlayer.palette].c2;
        c3 = paletteTable[thisPlayer.palette].c3;
        c4 = paletteTable[thisPlayer.palette].c4;

        if (client.transport.state === 'started') {
            if (transportSyncCount >= game.transportSyncInterval) {
                client.transport.seconds = time;
                transportSyncCount = 0;
                //console.log(client.transport.state);
            }
            transportSyncCount++
        }
        
        // Clear the canvas
        this.ctx.clearRect(0, 0, w, h);
        ctx[0].clearRect(0, 0, w, h);
        ctx[1].clearRect(0, 0, w, h);

        // Transform the canvas
        // Note that we need to flip the y axis since Canvas pixel coordinates
        // goes from top to bottom, while physics does the opposite.
        ctx[0].save();
        ctx[1].save();
        //ctx.scale(this.clientEngine.zoom, this.clientEngine.zoom);  // Zoom in and flip y axis
        // Draw all things
        this.drawPlayers();
        this.drawNoteGraphics();
        this.drawEggs();

        /*()
        ctx[1].fillStyle = c1;
        ctx[1].font = "20px Lucida Console";
        ctx[1].fillText(playerId, 50, 25);
        ctx[1].fillText(time, 50, 50);
        ctx[1].fillText(client.transport.position, 50, 75);
        */
        this.ctx.drawImage(canvas[0], 0, 0);
        this.ctx.drawImage(canvas[1], 0, 0);

        ctx[0].restore(); 
        ctx[1].restore();
    }

    drawPlayers() {
        let n = players.length;
        for (let p of players) {
            let i = p.number - (leftViewBound / game.playerWidth);
            let x = ((w / n) * i);
            this.fillColor(p, 'bg', 0);
            ctx[0].fillRect(x, 0, w / n, h / n)
        }
        let i = thisPlayer.number;
        let x = (w / n) * (i + 0.5);
        ctx[0].fillStyle = 'white';
        this.fillTriangle(  x,                      (1.05 * h) / n, 
                            x - ((0.25 * w) / n),   (1.15 * h) / n,
                            x + ((0.25 * w) / n),   (1.15 * h) / n, 0 );   
    }

    drawNoteGraphics() {
        for (let n of graphicNotes.egg.perc) this.drawEggPercNote(n);
        for (let n of graphicNotes.egg.bass) this.drawEggBassNote(n);
        for (let n of graphicNotes.egg.melody) this.drawEggMelodyNote(n);
    }

    drawEggs() {
        let leftBound = leftViewBound - game.eggRadius;
        let rightBound = rightViewBound + game.eggRadius;
        for (let e of eggs) {
            if (leftBound < e.position.x && e.position.x < rightBound) {
                let scale = this.mapToRange(e.animFrames.spawn, 0, animLengths.eggSpawn, 0.0, 1.0);
                ctx[1].fillStyle = 'white';
                ctx[1].strokeStyle = 'black';
                let gamePos = game.quantizedPosition(e.position.x, e.position.y, 16, 9);
                let pos = this.gamePositionToCanvasPosition(gamePos[0] + (game.playerWidth / 32), gamePos[1] + (game.playerHeight / 18));
                if (e.hp > 0) {
                    this.ellipse(pos[0], pos[1], 
                        this.gameXDimToCanvasXDim(game.eggRadius) * scale, 
                        this.gameYDimToCanvasYDim(game.eggRadius) * scale,
                        0, 0, 2*Math.PI, true, 1);
                }
                else this.drawBrokenEgg(e, pos[0], pos[1], 
                    this.gameXDimToCanvasXDim(game.eggRadius), this.gameYDimToCanvasYDim(game.eggRadius), true, 1);
            }
        if (e.animFrames.spawn < animLengths.eggSpawn) e.animFrames.spawn++;
        }
    }

    drawEggMelodyNote(n) {
        let pos = this.playerCellToCanvasPosition(thisPlayer, n.cell.x, n.cell.y, n.sequence.length, n.sequence.range);
        let dimX = this.gameXDimToCanvasXDim(game.playerWidth / n.sequence.length) / 2; 
        let dimY = this.gameYDimToCanvasYDim(game.playerHeight / n.sequence.range) / 2;
        let x = pos[0] + dimX;
        let y = pos[1] + dimY;
        dimY *= this.mapToRange(n.animFrame, 0, animLengths.eggNote, n.sequence.range, 1);
        dimX *= this.mapToRange(n.animFrame, 0, animLengths.eggNote, n.sequence.length, 1);
        // color
        let c = 'c2';
        let layer = 0;
        if (n.duration === '2n') {
            c = 'c4';
            layer = 1;
        }
        if (n.step === client.currentStep) c = 'c3'
        this.fillColor(thisPlayer, c, layer);
        this.ellipse(x, y, dimX, dimY, 0, 0, 2*Math.PI, false, layer);
        if (n.animFrame < animLengths.eggNote) n.animFrame++;
    }

    drawEggBassNote(n) {
        // generic position and dimensions of any egg sequence note
        let pos = this.playerCellToCanvasPosition(thisPlayer, n.cell.x, n.cell.y, n.sequence.length, n.sequence.range);
        let dimX = this.gameXDimToCanvasXDim(game.playerWidth / n.sequence.length); 
        let dimY = this.gameYDimToCanvasYDim(game.playerHeight / n.sequence.range);
        ////////////////////////////////////////
        // adjust generic values for animation
        let x = pos[0];
        let y = this.mapToRange(n.animFrame, 0, animLengths.eggNote, 0, pos[1]);
        dimY *= this.mapToRange(n.animFrame, 0, animLengths.eggNote, n.sequence.range, 1);
        // color
        let c = 'c1';
        let layer = 1;
        if (n.duration === '2n') {
            c = 'c3';
            dimX *= n.sequence.length / 2;
            layer = 0;
        }
        if (n.step === client.currentStep) c = 'c2'
        this.fillColor(thisPlayer, c, layer);
        ctx[layer].fillRect(x, y, dimX, dimY);
        if (n.animFrame < animLengths.eggNote) n.animFrame++;
    }

    drawEggPercNote(n) {

    }

    drawEggPercNode(n) {
        // generic position and dimensions of any egg sequence note
        let pos = this.playerCellToCanvasPosition(thisPlayer, n.cell.x, n.cell.y, n.sequence.length, n.sequence.range);
        let dimX = this.gameXDimToCanvasXDim(game.playerWidth / n.sequence.length); 
        let dimY = this.gameYDimToCanvasYDim((game.playerHeight / n.sequence.range));
        ////////////////////////////////////////
    }

    setRendererSize() {
        w = canvas[0].width = canvas[1].width = this.canvas.width = window.innerWidth;
        h = canvas[0].height = canvas[1].height = this.canvas.height = window.innerHeight;
    }

    gamePositionToCanvasPosition(gameX, gameY) {
        let canvasX = Math.floor(this.mapToRange(gameX, leftViewBound, rightViewBound, 0, w));
        let canvasY = Math.floor(this.mapToRange(gameY, 0, game.playerHeight, 0, h / players.length)); 
        return [canvasX, canvasY];
    }

    gameXDimToCanvasXDim(gameX) {
        return Math.floor(this.mapToRange(gameX, 0, game.playerWidth, 0, w / players.length));
    }

    gameYDimToCanvasYDim(gameY) {
        return Math.floor(this.mapToRange(gameY, 0, game.playerHeight, 0, h / players.length));
    }

    playerCellToCanvasPosition(p, cellX, cellY, cellsXPerPlayer, cellsYPerPlayer) {
        //let gameX = game.cellWidth * (cellX + (p.number * game.playerCellWidth));
        //let gameY = game.cellHeight * cellY;
        let gameX = (game.playerWidth / cellsXPerPlayer) * (cellX + (p.number * cellsXPerPlayer));
        let gameY = (game.playerHeight / cellsYPerPlayer) * cellY;
        return this.gamePositionToCanvasPosition(gameX, gameY);
    }

    mapToRange(val, l1, h1, l2, h2) {
        return (l2 + (h2 - l2) * (val - l1) / (h1 - l1));
    }

    drawBrokenEgg(e, x, y, radiusX, radiusY, stroke, layer) {
        let gapX = radiusX * (e.animFrames.break / animLengths.eggBreak);
        let gapY = radiusY * (e.animFrames.break / animLengths.eggBreak);
        this.ellipse(x+gapX, y-gapY, radiusX, radiusY, 0, 0, 0.5*Math.PI, stroke, layer)
        this.ellipse(x-gapX, y-gapY, radiusX, radiusY, 0, 0.5*Math.PI, Math.PI, stroke, layer)
        this.ellipse(x-gapX, y+gapY, radiusX, radiusY, 0, Math.PI, 1.5*Math.PI, stroke, layer)
        this.ellipse(x+gapX, y+gapY, radiusX, radiusY, 0, 1.5*Math.PI, 2*Math.PI, stroke, layer)
        if (e.animFrames.break < animLengths.eggBreak) e.animFrames.break++
    }

    fillColor(p, which, layer) {
        if (paletteTable[p.palette]) {
            ctx[layer].fillStyle = paletteTable[p.palette][which];
        }  
        else ctx[layer].fillStyle = paletteTable['default'][which];
    }

    ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, stroke, layer) {
        ctx[layer].beginPath();
        ctx[layer].ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle);
        ctx[layer].fill();
        if (stroke) ctx[layer].stroke();
    }

    fillTriangle(x1, y1, x2, y2, x3, y3, layer) {
        ctx[layer].beginPath();
        ctx[layer].moveTo(x1, y1);
        ctx[layer].lineTo(x2, y2);
        ctx[layer].lineTo(x3, y3);
        ctx[layer].fill();
        ctx[layer].closePath();
    }

}
