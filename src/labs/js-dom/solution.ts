import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';

/** Answer key for js-dom. Every move goes through the same model the editor uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const edit = (demo: string, code: string) => on(demo, { edit: 'script.js', code }, { run: true });

export const HELLO_DONE = `let title = document.getElementById("title");
title.textContent = "Sam Lee";

let tagline = document.getElementById("tagline");
tagline.textContent = "I build websites and bake bread.";

title.classList.add("highlight");
`;

export const ONE_DONE = `let about = document.getElementById("about");

let fact = document.createElement("p");
fact.textContent = "I have two cats.";
about.appendChild(fact);
`;

export const LIST_DONE = `let favorites = ["ramen", "chess", "hiking", "jazz"];
let list = document.getElementById("list");

for (let i = 0; i < favorites.length; i++) {
  let item = document.createElement("li");
  item.textContent = favorites[i];
  list.appendChild(item);
}
`;

export const GRID_DONE = `let count = 400;
let grid = document.getElementById("grid");

for (let i = 0; i < count; i++) {
  let cell = document.createElement("div");
  cell.classList.add("cell");
  let color = "hsl(" + i * 5 + ", 80%, 60%)";
  cell.style.backgroundColor = color;
  grid.appendChild(cell);
}
`;

export const EVERY_DONE = `let headings = document.querySelectorAll("h2");

for (let i = 0; i < headings.length; i++) {
  headings[i].classList.add("accent");
}
`;

export const CONTENTS_DONE = `let headings = document.querySelectorAll("h2");
let toc = document.getElementById("toc");

for (let i = 0; i < headings.length; i++) {
  let item = document.createElement("li");
  item.textContent = headings[i].textContent;
  toc.appendChild(item);
}
`;

export const CARDS_DONE = `let titles = ["Chess club", "Robot arm", "Bake sale"];
let details = ["We meet on Fridays.", "It stacks blocks.", "We raised $80."];
let cards = document.getElementById("cards");

for (let i = 0; i < titles.length; i++) {
  let card = document.createElement("div");
  card.classList.add("card");

  let heading = document.createElement("h3");
  heading.textContent = titles[i];
  let text = document.createElement("p");
  text.textContent = details[i];

  card.appendChild(heading);
  card.appendChild(text);
  cards.appendChild(card);
}
`;

export const MORE_DONE = `let grid = document.getElementById("grid");
let button = document.getElementById("more");
let n = 0;

button.addEventListener("click", function () {
  let cell = document.createElement("div");
  cell.classList.add("cell");
  cell.style.backgroundColor = "hsl(" + n * 20 + ", 80%, 60%)";
  grid.appendChild(cell);
  n = n + 1;
});
`;

export const jsDomSolution: LabSolution = {
  hello: { moves: edit('hello', HELLO_DONE) },
  one: { moves: edit('one', ONE_DONE) },
  list: { moves: edit('list', LIST_DONE) },
  grid: { moves: edit('grid', GRID_DONE) },
  every: { moves: edit('every', EVERY_DONE) },
  cards: { moves: edit('cards', CARDS_DONE) },
  reflect: {
    text: {
      'own-site': 'My site has a page of movies I like. The array would hold each movie title, and a second array would hold what I thought of it. The loop would make one card for each movie. Adding a movie would take one line, and I would not have to copy the HTML again.',
    },
  },
  contents: { moves: edit('contents', CONTENTS_DONE) },
  more: { moves: [...edit('more', MORE_DONE), ...on('more', { click: '#more' }, { click: '#more' })] },
};
