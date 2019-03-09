import path from 'path';
import express from 'express';
import socketIO from 'socket.io';
import Trace from 'lance/lib/Trace';
import InterferenceServerEngine from './src/server/InterferenceServerEngine';
import InterferenceGameEngine from './src/common/InterferenceGameEngine';

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, './dist/index.html');

// define routes and socket
const server = express();
server.get('/', function(req, res) { res.sendFile(INDEX); });
server.use('/', express.static(path.join(__dirname, './dist/')));
let requestHandler = server.listen(PORT, () => console.log(`Listening on ${ PORT }`));
const io = socketIO(requestHandler);

// Game Instances
const gameEngine = new InterferenceGameEngine({ traceLevel: Trace.TRACE_NONE });
const serverEngine = new InterferenceServerEngine(io, gameEngine, { debug: {}, updateRate: 6 });

// start the game
serverEngine.start();
