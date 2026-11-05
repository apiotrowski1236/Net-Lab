import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';
import { PET, SONG_BUILT, SONG_METHODS } from './code';

/** Answer key for java-classes. Every move goes through the same model the editor uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const edit = (demo: string, file: string, code: string) => on(demo, { edit: file, code }, { run: true });
const main = (body: string) => `public class Main {\n  public static void main(String[] args) {\n${body}\n  }\n}\n`;

const THREE_LOOSE = main(`    String name1 = "Ada";
    int health1 = 100;
    String name2 = "Grace";
    int health2 = 80;
    String name3 = "Linus";
    int health3 = 90;
    health1 = health1 - 30;
    System.out.println(name1 + " has " + health1);
    System.out.println(name2 + " has " + health2);
    System.out.println(name3 + " has " + health3);`);

const THREE_OBJECTS = main(`    Player ada = new Player("Ada", 100);
    Player grace = new Player("Grace", 80);
    Player linus = new Player("Linus", 90);
    ada.takeDamage(30);
    System.out.println(ada.getName() + " has " + ada.getHealth());
    System.out.println(grace.getName() + " has " + grace.getHealth());
    System.out.println(linus.getName() + " has " + linus.getHealth());`);

const guarded = (line: string) => main(`    Player ada = new Player("Ada", 100);\n    ${line}\n    System.out.println(ada.getName() + " has " + ada.getHealth());`);

const SONG_DONE = SONG_METHODS.replace(
  /\}\n$/,
  `
  public void addPlays(int amount) {
    plays = plays + amount;
  }
}
`,
);

const PET_DONE = PET[0].text.replace('name = name;', 'this.name = name;').replace('age = age;', 'this.age = age;');

const BANK_DONE = `public class BankAccount {
  private String owner;
  private int balance;

  public BankAccount(String ownerIn, int balanceIn) {
    owner = ownerIn;
    balance = balanceIn;
  }

  public int getBalance() {
    return balance;
  }

  public void deposit(int amount) {
    balance = balance + amount;
  }

  public void withdraw(int amount) {
    if (amount <= balance) {
      balance = balance - amount;
    }
  }
}
`;

const PLAYLIST_DONE = `import java.util.ArrayList;

public class Playlist {
  private ArrayList<Song> songs;

  public Playlist() {
    songs = new ArrayList<Song>();
  }

  public void add(Song song) {
    songs.add(song);
  }

  public int getTotalPlays() {
    int total = 0;
    for (Song s : songs) {
      total = total + s.getPlays();
    }
    return total;
  }

  public Song getMostPlayed() {
    Song best = songs.get(0);
    for (Song s : songs) {
      if (s.getPlays() > best.getPlays()) {
        best = s;
      }
    }
    return best;
  }
}
`;

/** Steps through the whole program, one press of Next at a time. */
const stepAll = (demo: string, steps: number) => on(demo, { stepping: true }, ...Array.from({ length: steps }, (_, i) => ({ seek: i + 1 })));

export const javaClassesSolution: LabSolution = {
  why: { moves: [...on('loose', { run: true }), ...edit('loose', 'Main.java', THREE_LOOSE)] },
  what: { moves: on('stamp', { make: true }, { make: true }, { hit: 0 }) },
  anatomy: { moves: [...on('players', { tab: 'Player.java' }), ...edit('players', 'Main.java', THREE_OBJECTS)] },
  trace: { moves: stepAll('trace', 16) },
  private: { moves: [...edit('guard', 'Main.java', guarded('ada.health = -50;')), ...edit('guard', 'Main.java', guarded('ada.takeDamage(500);'))] },
  'fields-ctor': { moves: edit('song', 'Song.java', SONG_BUILT) },
  getters: { moves: edit('song', 'Song.java', SONG_METHODS) },
  mutators: { moves: edit('song', 'Song.java', SONG_DONE) },
  this: { moves: edit('pets', 'Pet.java', PET_DONE) },
  scratch: { moves: edit('bank', 'BankAccount.java', BANK_DONE) },
  reflect: {
    text: {
      'why-class':
        'An Enemy class is one blueprint, and each of the 20 enemies is an object made from it. Each object keeps its own instance variables, like health and position, so there are no loose variables. Keeping them private means only Enemy methods can change them, and a constructor sets up each new enemy with its starting values.',
    },
  },
  playlist: { moves: edit('list', 'Playlist.java', PLAYLIST_DONE) },
};
