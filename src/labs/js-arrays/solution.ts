import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';
import { LOG_PLAYLIST } from './code';

/** Answer key for js-arrays. Every move goes through the same model the editor uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const edit = (demo: string, code: string) => on(demo, { edit: 'script.js', code }, { run: true });

export const WARMUP_DONE = `let playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell"];

alert("The dance starts at 7:00.");
console.log(playlist);
`;

export const MAKE_DONE = `// Add a third song to this array.
let openers = ["Neon Lockers", "Bus Stop Rain", "Midnight Bleachers"];

// Tickets sold by each grade: 40, 55, 62, and 71.
let ticketsSold = [40, 55, 62, 71];

// Nobody has asked for a song yet.
let requests = [];

console.log(openers);
console.log(ticketsSold);
console.log(requests);
`;

export const READ_DONE = `let playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon", "Hallway Echo"];

// The first song is at index 0.
console.log(playlist[0]);

// Print the third song.
console.log(playlist[2]);

// Print how many songs are on the playlist.
console.log(playlist.length);

// Print the last song.
console.log(playlist[playlist.length - 1]);
`;

export const CHANGE_DONE = `const playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon"];
const votes = [12, 9, 15, 7];

playlist[1] = "Thunder Gym";
playlist[playlist.length - 1] = "Parking Lot Stars";
votes[2] = votes[2] + 1;

console.log(playlist);
console.log(votes);
`;

export const EDGES_DONE = `const playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon", "Hallway Echo"];

let removed = playlist.pop();
console.log(removed);
playlist.push("Thunder Gym");
let nowPlaying = playlist.shift();
console.log(nowPlaying);
playlist.unshift("Senior Sunset");

console.log(playlist);
`;

export const SEARCH_DONE = `const banned = ["detention anthem", "food fight", "skip class"];
const playlist = ["neon lockers", "bus stop rain", "last bell", "cafeteria moon"];

let request = prompt("What song do you want to hear?");
request = request.toLowerCase();

let spot = playlist.indexOf(request);
if (banned.includes(request)) {
  console.log("Sorry, that song is banned.");
} else if (spot === -1) {
  console.log("Not on the playlist yet.");
} else {
  console.log("That song is number " + (spot + 1) + ".");
}
`;

export const SHOW_DONE = `const playlist = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon", "Hallway Echo"];

alert(playlist.join(", "));

let spot = Math.floor(Math.random() * playlist.length);
console.log(playlist[spot]);
`;

export const PROGRAM_DONE = `// The request line for the dance.
let requests = ["Neon Lockers", "Bus Stop Rain", "Last Bell"];
let song = prompt("What song do you want to hear?");

if (requests.includes(song)) {
  console.log("That song is already on the list.");
} else {
  requests.push(song);
}

console.log(requests.join(", "));
console.log(requests.length + " songs on the list.");

let spot = Math.floor(Math.random() * requests.length);
console.log("Next up: " + requests[spot]);
`;

export const REMOVE_DONE = `const requests = ["Neon Lockers", "Bus Stop Rain", "Last Bell", "Cafeteria Moon"];

let song = prompt("Which song should come off the list?");

let spot = requests.indexOf(song);
if (spot === -1) {
  console.log("That song is not on the list.");
} else {
  requests.splice(spot, 1);
}

console.log(requests.join(", "));
`;

/** Steps through a whole program, one press of Next at a time. */
const stepAll = (demo: string, steps: number) => on(demo, { stepping: true }, ...Array.from({ length: steps }, (_, i) => ({ seek: i + 1 })), { stepping: false });

export const jsArraysSolution: LabSolution = {
  warmup: { moves: [...on('warmup', { run: true }, { hint: LOG_PLAYLIST.id }), ...edit('warmup', WARMUP_DONE), ...stepAll('warmup', 4)] },
  make: { moves: edit('make', MAKE_DONE) },
  read: { moves: edit('read', READ_DONE) },
  change: { moves: edit('change', CHANGE_DONE) },
  edges: { moves: edit('edges', EDGES_DONE) },
  search: { moves: [...edit('search', SEARCH_DONE), ...on('search', { answer: 'Last Bell' })] },
  show: { moves: edit('show', SHOW_DONE) },
  program: { moves: [...edit('program', PROGRAM_DONE), ...on('program', { answer: 'Thunder Gym' })] },
  reflect: {
    text: {
      explain:
        'The indexes stop one short of the length, so playlist[playlist.length] looks one spot past the end and gives undefined. Use playlist.length - 1 for the last index. indexOf gives -1 when the song is not on the list, and -1 is not a real index, so test for -1 with an if before you use the result.',
    },
  },
  remove: { moves: [...edit('remove', REMOVE_DONE), ...on('remove', { answer: 'Last Bell' })] },
};
