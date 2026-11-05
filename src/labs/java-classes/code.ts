import type { JavaCheck, JavaCheckCtx, JavaFile } from '../../demos/types';

/** Starting code and hidden checks for the lab. Nothing here is shown as a step's text. */

const main = (body: string) => `public class Main {
  public static void main(String[] args) {
${body
  .split('\n')
  .map((l) => (l ? `    ${l}` : ''))
  .join('\n')}
  }
}
`;

export const LOOSE: JavaFile[] = [
  {
    name: 'Main.java',
    text: main(`String name1 = "Ada";
int health1 = 100;

String name2 = "Grace";
int health2 = 80;

// Ada gets hit for 30 points.
health1 = health1 - 30;

System.out.println(name1 + " has " + health1);
System.out.println(name2 + " has " + health2);`),
  },
];

const PLAYER = `public class Player {
  // Instance variables: each object's data.
  private String name;
  private int health;

  // Constructor: runs when new makes an object.
  public Player(String nameIn, int healthIn) {
    name = nameIn;
    health = healthIn;
  }

  // Method: changes this object's health.
  public void takeDamage(int amount) {
    health = health - amount;
    if (health < 0) {
      health = 0;
    }
  }

  // Method: gives back this object's health.
  public int getHealth() {
    return health;
  }

  // Method: gives back this object's name.
  public String getName() {
    return name;
  }
}
`;

/** Player, to read but not change. */
const PLAYER_FILE: JavaFile = { name: 'Player.java', text: PLAYER, locked: true };

const playerFiles = (body: string): JavaFile[] => [{ name: 'Main.java', text: main(body) }, PLAYER_FILE];

export const PLAYERS = playerFiles(`Player ada = new Player("Ada", 100);
Player grace = new Player("Grace", 80);

ada.takeDamage(30);

System.out.println(ada.getName() + " has " + ada.getHealth());
System.out.println(grace.getName() + " has " + grace.getHealth());`);

export const TRACED = playerFiles(`Player ada = new Player("Ada", 100);
Player grace = new Player("Grace", 80);

ada.takeDamage(30);

System.out.println(ada.getHealth());
System.out.println(grace.getHealth());`);

export const GUARDED = playerFiles(`Player ada = new Player("Ada", 100);

// Your line goes here.

System.out.println(ada.getName() + " has " + ada.getHealth());`);

const EMPTY_SONG = `public class Song {
  // Declare three private instance variables here.

  // Write the constructor here.

}
`;

export const SONG_START: JavaFile[] = [
  { name: 'Song.java', text: EMPTY_SONG },
  {
    name: 'Main.java',
    text: main(`Song first = new Song("Neon Rain", "The Tin Owls");
Song second = new Song("Paper Road", "Dana Reyes");

System.out.println("Made two songs.");`),
  },
  PLAYER_FILE,
];

export const SONG_BUILT = `public class Song {
  private String title;
  private String artist;
  private int plays;

  public Song(String songTitleIn, String songArtistIn) {
    title = songTitleIn;
    artist = songArtistIn;
    plays = 0;
  }
}
`;

export const SONG_GETTERS: JavaFile[] = [
  { name: 'Song.java', text: SONG_BUILT },
  {
    name: 'Main.java',
    text: main(`Song first = new Song("Neon Rain", "The Tin Owls");
Song second = new Song("Paper Road", "Dana Reyes");

System.out.println(first.getPlays());
System.out.println(second.getSummary());`),
  },
  PLAYER_FILE,
];

export const SONG_METHODS = `public class Song {
  private String title;
  private String artist;
  private int plays;

  public Song(String songTitleIn, String songArtistIn) {
    title = songTitleIn;
    artist = songArtistIn;
    plays = 0;
  }

  public int getPlays() {
    return plays;
  }

  public String getSummary() {
    return title + " by " + artist + ", " + plays + " plays";
  }
}
`;

export const SONG_MUTATORS: JavaFile[] = [
  { name: 'Song.java', text: SONG_METHODS },
  {
    name: 'Main.java',
    text: main(`Song first = new Song("Neon Rain", "The Tin Owls");
Song second = new Song("Paper Road", "Dana Reyes");

first.addPlays(3);
second.addPlays(10);

System.out.println(first.getSummary());
System.out.println(second.getSummary());`),
  },
  PLAYER_FILE,
];

export const PET: JavaFile[] = [
  {
    name: 'Pet.java',
    text: `public class Pet {
  private String name;
  private int age;

  public Pet(String name, int age) {
    name = name;
    age = age;
  }

  public String getSummary() {
    return name + " is " + age;
  }
}
`,
  },
  {
    name: 'Main.java',
    text: main(`Pet biscuit = new Pet("Biscuit", 4);
Pet mochi = new Pet("Mochi", 7);

System.out.println(biscuit.getSummary());
System.out.println(mochi.getSummary());`),
  },
];

export const BANK: JavaFile[] = [
  {
    name: 'BankAccount.java',
    text: `public class BankAccount {

}
`,
  },
  {
    name: 'Main.java',
    text: main(`BankAccount first = new BankAccount("Ada", 100);
BankAccount second = new BankAccount("Grace", 50);

first.deposit(25);
second.withdraw(80);

System.out.println(first.getBalance());
System.out.println(second.getBalance());`),
  },
  PLAYER_FILE,
];

export const PLAYLIST: JavaFile[] = [
  {
    name: 'Playlist.java',
    text: `import java.util.ArrayList;

public class Playlist {
  private ArrayList<Song> songs;

  public Playlist() {
    songs = new ArrayList<Song>();
  }

  // Write add, getTotalPlays, and getMostPlayed here.

}
`,
  },
  { name: 'Song.java', text: SONG_METHODS },
  {
    name: 'Main.java',
    text: main(`Playlist mix = new Playlist();

Song first = new Song("Neon Rain", "The Tin Owls");
Song second = new Song("Paper Road", "Dana Reyes");
first.addPlays(3);
second.addPlays(8);

mix.add(first);
mix.add(second);

System.out.println(mix.getTotalPlays());
System.out.println(mix.getMostPlayed().getSummary());`),
  },
];

// --- checks ---

/** The lines of a program's output, without the spaces at their ends. */
const lines = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => l.trim());

function needField(c: JavaCheckCtx, cls: string, name: string, type: string): string | undefined {
  const f = c.field(cls, name);
  if (!f) return `${cls} needs an instance variable called ${name}. Write: private ${type} ${name};`;
  if (f.type !== type) return `${name} should be a ${type}, not a ${f.type}.`;
  if (f.isStatic) return `${name} should not be static. Each object needs its own ${name}.`;
  if (f.access !== 'private') return `${name} should be private. Put private in front of it.`;
  return undefined;
}

const PARAM: Record<string, string> = { int: 'int amount', Song: 'Song song' };

function needMethod(c: JavaCheckCtx, cls: string, name: string, ret: string, ...params: string[]): string | undefined {
  const m = c.method(cls, name, ...params);
  if (!m) return `${cls} needs a method: public ${ret} ${name}(${params.map((p) => PARAM[p]).join(', ')})`;
  if (m.ret !== ret) return `${name} should return ${ret === 'void' ? 'nothing, so write void' : ret}, not ${m.ret}.`;
  if (m.isStatic) return `${name} should not be static. It works on one object.`;
  if (m.access !== 'public') return `${name} should be public, so other classes can call it.`;
  return undefined;
}

/** Runs hidden code, and compares what it prints to `want`, ignoring spaces at the ends of lines. */
function expectRun(c: JavaCheckCtx, body: string, want: string, wrong: (got: string) => string): string | undefined {
  const r = c.run(body);
  if (r.failed) return r.failed;
  return lines(r.output).join('\n') === want ? undefined : wrong(r.output.trim());
}

export const THIRD_PLAYER: JavaCheck = {
  id: 'third',
  label: 'Main prints three players, one of them Linus',
  main: true,
  test(c) {
    if (!/Linus/.test(c.output) || lines(c.output).length < 3) return 'Run a version that prints a third line about Linus.';
    return /String\s+\w+\s*=\s*"Linus"/.test(c.source('Main.java')) ? undefined : 'Make variables for Linus, the same way Ada and Grace have them, and print those.';
  },
};

export const THIRD_OBJECT: JavaCheck = {
  id: 'third',
  label: 'Main makes a third Player for Linus and prints it',
  main: true,
  test(c) {
    const src = c.source('Main.java');
    if (!/new\s+Player\s*\(\s*"Linus"/.test(src)) return 'Add a line that makes a Player with new. Give it the name "Linus" and 90 health.';
    if (/Player@/.test(c.output)) return 'Printing a Player object directly shows a code, like Player@1b, because Java does not know which parts to print. Print its name and health the way the other lines do.';
    return /Linus has 90/.test(c.output) ? undefined : 'Print Linus the same way the other two are printed. It should show: Linus has 90';
  },
};

export const ENCAPSULATED: JavaCheck = {
  id: 'fixed',
  label: 'Main calls takeDamage(500), and Ada ends at 0',
  main: true,
  test(c) {
    const src = c.source('Main.java');
    if (/\.health\b/.test(src)) return 'Delete the line that uses ada.health.';
    if (!/ada\s*\.\s*takeDamage\s*\(\s*500\s*\)/.test(src)) return 'Call the method instead: ada.takeDamage(500);';
    return /Ada has 0\b/.test(c.output) ? undefined : 'Keep the line that prints Ada, so you can see her health is 0.';
  },
};

export const SONG_FIELDS: JavaCheck = {
  id: 'fields',
  label: 'Song has private instance variables title, artist, and plays',
  test: (c) => needField(c, 'Song', 'title', 'String') ?? needField(c, 'Song', 'artist', 'String') ?? needField(c, 'Song', 'plays', 'int'),
};

export const SONG_CTOR: JavaCheck = {
  id: 'ctor',
  label: 'Song has a constructor that takes the title and the artist',
  test: (c) => (c.ctor('Song', 'String', 'String') ? undefined : 'Write a constructor: public Song(String songTitleIn, String songArtistIn). Write nothing between public and Song.'),
};

export const SONG_SETS: JavaCheck = {
  id: 'sets',
  label: 'The constructor stores both values and starts plays at 0',
  test: (c) =>
    expectRun(c, 'Song s = new Song("A", "B");\nSystem.out.println(s.title + "|" + s.artist + "|" + s.plays);', 'A|B|0', (got) => {
      if (got.startsWith('null')) return 'title is still null. In the constructor, store songTitleIn in the instance variable title.';
      if (got.includes('|null')) return 'artist is still null. In the constructor, store songArtistIn in the instance variable artist.';
      if (got.startsWith('B')) return 'The title and the artist are swapped. Check which parameter goes where.';
      return 'plays should start at 0.';
    }),
};

export const SONG_ACCESSORS: JavaCheck = {
  id: 'getters',
  label: 'getPlays gives back the plays',
  test: (c) => needMethod(c, 'Song', 'getPlays', 'int') ?? expectRun(c, 'System.out.println(new Song("A", "B").getPlays());', '0', () => 'getPlays should return the instance variable plays.'),
};

export const SONG_SUMMARY: JavaCheck = {
  id: 'summary',
  label: 'getSummary gives back text like: Neon Rain by The Tin Owls, 0 plays',
  test: (c) =>
    needMethod(c, 'Song', 'getSummary', 'String') ??
    expectRun(c, 'System.out.println(new Song("Neon Rain", "The Tin Owls").getSummary());', 'Neon Rain by The Tin Owls, 0 plays', (got) => `It gave back: ${got}\nIt should be: Neon Rain by The Tin Owls, 0 plays`),
};

export const SONG_ADD: JavaCheck = {
  id: 'add',
  label: 'addPlays(int amount) adds that many plays',
  test: (c) =>
    needMethod(c, 'Song', 'addPlays', 'void', 'int') ??
    expectRun(c, 'Song a = new Song("A", "B");\na.addPlays(5);\na.addPlays(2);\nSystem.out.println(a.plays);', '7', () => 'After addPlays(5) and addPlays(2), plays should be 7. Add the amount to plays. Don\'t replace it.'),
};

export const PET_FIXED: JavaCheck = {
  id: 'fixed',
  label: 'The constructor stores the name and the age',
  test: (c) =>
    expectRun(c, 'System.out.println(new Pet("Biscuit", 4).getSummary());', 'Biscuit is 4', (got) => {
      const fix = (name: string) => `${name} is still empty. In the constructor, write this.${name} on the left of the =.`;
      if (got.startsWith('Biscuit')) return fix('age');
      return got.endsWith(' 4') ? fix('name') : 'name and age are still empty. In the constructor, write this. in front of the instance variable on the left of each =.';
    }) ??
    (/this\s*\.\s*name\s*=/.test(c.source('Pet.java')) && /this\s*\.\s*age\s*=/.test(c.source('Pet.java')) ? undefined : 'That works, but this step is practice with this. Keep the parameters called name and age, and write this.name = name;'),
};

export const BANK_CTOR: JavaCheck = {
  id: 'ctor',
  label: 'BankAccount has private owner and balance, and a constructor that stores them',
  test: (c) =>
    needField(c, 'BankAccount', 'owner', 'String') ??
    needField(c, 'BankAccount', 'balance', 'int') ??
    (c.ctor('BankAccount', 'String', 'int') ? undefined : 'Write a constructor with two parameters: a String and an int.') ??
    expectRun(c, 'BankAccount a = new BankAccount("Ada", 50);\nSystem.out.println(a.owner + "|" + a.balance);', 'Ada|50', () => 'The constructor should store both values in the instance variables.'),
};

export const BANK_BALANCE: JavaCheck = {
  id: 'balance',
  label: 'getBalance gives back the balance',
  test: (c) => needMethod(c, 'BankAccount', 'getBalance', 'int') ?? expectRun(c, 'System.out.println(new BankAccount("Ada", 50).getBalance());', '50', () => 'getBalance should return the balance.'),
};

export const BANK_DEPOSIT: JavaCheck = {
  id: 'deposit',
  label: 'deposit(int amount) adds to the balance',
  test: (c) =>
    needMethod(c, 'BankAccount', 'deposit', 'void', 'int') ??
    expectRun(c, 'BankAccount a = new BankAccount("Ada", 50);\na.deposit(25);\nSystem.out.println(a.getBalance());', '75', () => 'After deposit(25), a balance of 50 should be 75.'),
};

export const BANK_WITHDRAW: JavaCheck = {
  id: 'withdraw',
  label: 'withdraw(int amount) subtracts, but never takes the balance below 0',
  test: (c) =>
    needMethod(c, 'BankAccount', 'withdraw', 'void', 'int') ??
    expectRun(c, 'BankAccount a = new BankAccount("Ada", 50);\na.withdraw(20);\nSystem.out.println(a.getBalance());', '30', () => 'After withdraw(20), a balance of 50 should be 30.') ??
    expectRun(c, 'BankAccount a = new BankAccount("Ada", 50);\na.withdraw(51);\nSystem.out.println(a.getBalance());', '50', () => 'withdraw(51) from a balance of 50 should change nothing. Use an if.') ??
    expectRun(c, 'BankAccount a = new BankAccount("Ada", 50);\na.withdraw(50);\nSystem.out.println(a.getBalance());', '0', () => 'withdraw(50) from a balance of 50 should leave 0. You can take out all of it.'),
};

export const LIST_ADD: JavaCheck = {
  id: 'add',
  label: 'add(Song song) puts a song on the list',
  test: (c) => needMethod(c, 'Playlist', 'add', 'void', 'Song') ?? expectRun(c, 'Playlist p = new Playlist();\np.add(new Song("A", "B"));\nSystem.out.println(p.songs.size());', '1', () => 'add should put the song in the ArrayList.'),
};

export const LIST_TOTAL: JavaCheck = {
  id: 'total',
  label: 'getTotalPlays adds up the plays of every song',
  test: (c) =>
    needMethod(c, 'Playlist', 'getTotalPlays', 'int') ??
    expectRun(c, 'Playlist p = new Playlist();\nSystem.out.println(p.getTotalPlays());\nSong a = new Song("A", "B");\na.addPlays(3);\nSong b = new Song("C", "D");\nb.addPlays(4);\np.add(a);\np.add(b);\nSystem.out.println(p.getTotalPlays());', '0\n7', () => 'Songs with 3 and 4 plays should total 7. An empty playlist should total 0.'),
};

export const LIST_MOST: JavaCheck = {
  id: 'most',
  label: 'getMostPlayed gives back the song with the most plays',
  test: (c) =>
    needMethod(c, 'Playlist', 'getMostPlayed', 'Song') ??
    expectRun(c, 'Playlist p = new Playlist();\nSong a = new Song("A", "B");\na.addPlays(3);\nSong b = new Song("C", "D");\nb.addPlays(9);\nSong d = new Song("E", "F");\nd.addPlays(4);\np.add(a);\np.add(b);\np.add(d);\nSystem.out.println(p.getMostPlayed().getPlays());', '9', () => 'It should find the song with the highest plays, wherever it is in the list.'),
};
