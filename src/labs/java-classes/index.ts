import type { JavaCheck, JavaSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { GoalDef, LabDef } from '../types';
import * as code from './code';

/**
 * Write Your First Class (AP CSA, Unit 3). A lesson with no network: the stage
 * holds a Java editor (src/demos/java.ts), and src/java compiles and runs the
 * code in the browser. Plan: PLAN.md.
 */

/** A goal met when one of a demo's checks passes. */
const passed = (demo: string, check: JavaCheck, label: string, hint?: string): GoalDef => ({
  id: check.id,
  label,
  hint,
  check: demoFact(demo, (f) => f[`check:${check.id}`] === true),
});

const songChecks: JavaCheck[] = [code.SONG_FIELDS, code.SONG_CTOR, code.SONG_SETS];
const getterChecks: JavaCheck[] = [code.SONG_ACCESSORS, code.SONG_SUMMARY];
const mutatorChecks: JavaCheck[] = [code.SONG_ADD];
const bankChecks: JavaCheck[] = [code.BANK_CTOR, code.BANK_BALANCE, code.BANK_DEPOSIT, code.BANK_WITHDRAW];
const listChecks: JavaCheck[] = [code.LIST_ADD, code.LIST_TOTAL, code.LIST_MOST];

const songEditor: JavaSpec = { kind: 'java', id: 'song', title: 'Write the Song class', files: code.SONG_START, checks: songChecks };

export const javaClassesLab: LabDef = {
  id: 'java-classes',
  version: 2,
  title: 'Write Your First Class',
  tagline: 'See why programs need classes, watch objects get built one line at a time, then write your own Song and BankAccount classes.',
  // AP CSA Unit 3, Class Creation: topics 3.3, 3.4, 3.5, 3.8, and 3.9.
  unit: 3,
  codehs: [],
  ced: ['3.3.A', '3.4.A', '3.5.A', '3.8.A', '3.9.A'],
  minutes: 60,
  objectives: [
    'Explain what a class and an object are, and when a program should use a class',
    'Write private instance variables and a constructor that sets them',
    'Write accessor and mutator methods, and predict what calling them does',
    'Explain where a variable can be used, and use this when a parameter hides an instance variable',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'why',
      title: 'Too many variables',
      body: md`
        Programs keep track of things: players in a game, songs in an app, students in a class. In this lab you'll teach Java about a new kind of thing, by writing a **class**.

        First, see the problem a class solves. This code tracks two players in a game. Each player has a name and a health number, so each player needs two variables.

        1. Press **Run**. Read what it prints.
        2. Add a third player named Linus, with 90 health. Print Linus too, then press **Run** again.

        Before Java runs your code, it checks all of it. This is called **compiling**. If it finds a mistake, it shows an error, and nothing runs.
      `,
      demos: [{ kind: 'java', id: 'loose', title: 'Tracking players', files: code.LOOSE, checks: [code.THIRD_PLAYER] }],
      goals: [
        { id: 'ran', label: 'Run the code.', hint: 'Press the **Run** button above the code.', check: demoFact('loose', (f) => (f.runs as number) > 0) },
        passed('loose', code.THIRD_PLAYER, 'Add a third player named Linus, and print that player.', 'Copy the two lines for Grace, change the names to name3 and health3, then copy the print line too.'),
      ],
      questions: [
        {
          id: 'fifty',
          kind: 'choice',
          prompt: 'A real game has 50 players. Each player has a name, a health number, and a score. How many separate variables would this style of code need?',
          options: [
            { id: '3', text: '3', feedback: 'That covers one player. Each of the 50 players needs their own three.' },
            { id: '50', text: '50', feedback: 'That gives each player one variable, but each player has three values to keep.' },
            { id: '53', text: '53', feedback: 'The counts multiply. They do not add. Each of the 50 players has 3 values.' },
            { id: '150', text: '150', correct: true },
          ],
          explain: '50 players times 3 values is 150 variables. That is two problems: too many variables to write, and nothing in the code says which name goes with which score. A class fixes both.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'what',
      title: 'Classes and objects',
      body: md`
        A **class** is a blueprint: a plan that describes one kind of thing. An **object** is one thing built from that plan. One class can make as many objects as you need.

        A class says two things about every object it makes:

        - **Attributes** are the data each object keeps. A player has a name and health.
        - **Behaviors** are what each object can do. A player can take damage.

        Try it. Press **new Player** to make two objects. Then press **takeDamage(10)** on only one of them, and watch the other. (This demo stops at three objects. A real program can make more.)

        **When should you write a class?**

        - You have data that belongs together, like a song's title, artist, and play count.
        - You need many of the same kind of thing: 30 students, 50 players, 1,000 songs.
        - You have rules to protect. A bank balance should never go below 0.
      `,
      demos: [
        {
          kind: 'objects',
          id: 'stamp',
          title: 'One class, many objects',
          cls: 'Player',
          hit: 10,
          make: [
            { name: 'ada', label: 'Ada', health: 100 },
            { name: 'grace', label: 'Grace', health: 80 },
            { name: 'linus', label: 'Linus', health: 90 },
          ],
        },
      ],
      goals: [
        { id: 'two', label: 'Make two objects from the Player class.', hint: 'Press **new Player** twice.', check: demoFact('stamp', (f) => (f.made as number) >= 2) },
        { id: 'separate', label: 'Hit one object, and leave another one alone.', hint: 'Press **takeDamage(10)** on one card only.', check: demoFact('stamp', (f) => f.separate === true) },
      ],
      questions: [
        {
          id: 'when',
          kind: 'choice',
          prompt: 'A music app tracks thousands of songs. Each has a title, an artist, and a play count. What is the best design?',
          options: [
            { id: 'vars', text: 'Three variables for each song', feedback: 'That is thousands of loose variables, the problem from step 1.' },
            { id: 'one', text: 'One Song class, and one object per song', correct: true },
            { id: 'many', text: 'One class per song: Song1, Song2, and so on', feedback: 'All songs have the same attributes, so one blueprint is enough. Each song is an object, not a class.' },
            { id: 'text', text: 'One long String holding every song', feedback: 'Then the program would have to dig through text to find one play count, and nothing keeps the data in order.' },
          ],
          explain: 'A class describes the kind of thing. Each song is an object, with its own title, artist, and play count.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'anatomy',
      title: 'Read a real class',
      body: md`
        Here is the Player class in real Java. Open the **Player.java** tab and find each part. Comments in the code name them too.

        | Part | What it does |
        | --- | --- |
        | \`public class Player\` | Starts the class. The file has the same name. |
        | **Instance variables** | The attributes. Every object gets its own copy. |
        | **Constructor** | Sets up a new object. It has the same name as the class. |
        | **Methods** | The behaviors. Other code calls them with a dot. |

        **Main.java** is a second class. Java starts every program at its \`main\` method. Main uses Player to make objects.

        You don't need every word yet. Later steps explain private, return, and void.

        Notice how much shorter Main is than your code from step 1. Now add Linus: one line makes the object, with the name "Linus" and 90 health. One more line prints it. Press **Run**.
      `,
      demos: [{ kind: 'java', id: 'players', title: 'Two classes working together', files: code.PLAYERS, checks: [code.THIRD_OBJECT] }],
      goals: [
        { id: 'opened', label: 'Open the Player.java tab.', hint: 'Press the **Player.java** tab.', check: demoFact('players', (f) => f['opened:Player.java'] === true) },
        passed('players', code.THIRD_OBJECT, 'Make a third Player for Linus, and print it.', 'Copy the line that makes grace. Change the variable name, the name, and the health. Then copy a print line.'),
      ],
      questions: [
        {
          id: 'ctor',
          kind: 'choice',
          prompt: 'Which part of Player runs when Java reaches `new Player("Ada", 100)`?',
          options: [
            { id: 'ctor', text: 'The constructor', correct: true },
            { id: 'damage', text: 'takeDamage', feedback: 'A method runs only when code calls it with a dot, like ada.takeDamage(30).' },
            { id: 'main', text: 'main', feedback: 'main is where the program starts. It is already running, and it is the code that says new.' },
            { id: 'get', text: 'getHealth', feedback: 'A method runs only when code calls it with a dot, like ada.getHealth().' },
          ],
          explain: 'new builds the object, then the constructor runs once to set it up. The two values in parentheses are handed to the constructor.',
        },
        {
          id: 'read',
          kind: 'choice',
          prompt: 'In **Player.java**, look at the first line of the constructor. What two names are inside its parentheses?',
          options: [
            { id: 'in', text: 'nameIn and healthIn', correct: true },
            { id: 'fields', text: 'name and health', feedback: 'Those are the instance variables, declared above the constructor. Read the line that starts public Player.' },
            { id: 'main', text: 'ada and grace', feedback: 'Those are variables in Main.java. Open Player.java and read the line that starts public Player.' },
            { id: 'values', text: 'Ada and 100', feedback: 'Those are the values Main passes in. Open Player.java and read the line that starts public Player.' },
          ],
          explain: 'nameIn and healthIn receive the values from new Player("Ada", 100). The next two lines store them in the instance variables.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'trace',
      title: 'Watch an object get built',
      body: md`
        Now watch a Player program run one line at a time.

        Press **Step through**, then keep pressing **Next** until the program ends. The marked line is the one **about to run**. The picture plays what that line does until you press **Next**. The blue line and the \`Next:\` label show where Java goes after it.

        Read the sentence that explains each line. It names each new idea as it happens.

        Press **Pause** to see a line's finished work. Press **Back a line** any time.
      `,
      demos: [{ kind: 'java', id: 'trace', title: 'One line at a time', files: code.TRACED, step: true }],
      goals: [{ id: 'end', label: 'Step through to the end of the program.', hint: 'Press **Step through**, then keep pressing **Next** until it stops.', check: demoFact('trace', (f) => f.finished === true) }],
      questions: [
        {
          id: 'default',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Press **Stop**, then **Step through**, then **Next** once, to reach Step 2 of 17. The Ada object already exists. What is its health before the constructor sets it?',
          options: [
            { id: '0', text: '0', correct: true },
            { id: '100', text: '100', feedback: 'That comes later. At Step 2, look at the object box, before the constructor stores the value.' },
            { id: 'null', text: 'null', feedback: 'null is the default for references, like the String name. health is an int.' },
            { id: 'none', text: 'It has no value yet', feedback: 'Look at the object box. Java fills in a value as soon as the object exists.' },
          ],
          explain: 'Java fills in the default values first: 0 for int, 0.0 for double, false for boolean, and null for references. Then the constructor runs.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'private',
      title: 'Why private?',
      body: md`
        Player's instance variables say **private**. Only code inside the Player class can use or change them. **public** means any class can use it.

        See what happens when Main tries to break the rule.

        1. In Main, replace the comment line with \`ada.health = -50;\` and press **Run**. Read the error. Java refused to compile this.
        2. Replace that line with \`ada.takeDamage(500);\` and press **Run**. Ada's health stops at 0, because takeDamage has an if that checks it.

        Keeping data private and offering public methods is called **data encapsulation**. Other classes can only change the data through the methods you allow, so the class can protect its own rules.

        In AP CSA, classes and constructors are public, and instance variables are private.
      `,
      demos: [{ kind: 'java', id: 'guard', title: 'Try to break the rule', files: code.GUARDED, checks: [code.ENCAPSULATED] }],
      goals: [
        { id: 'blocked', label: 'See Java refuse `ada.health = -50;`', hint: 'Type the line exactly, with a semicolon, then press **Run**.', check: demoFact('guard', (f) => (f.errors as string).includes('private-access')) },
        passed('guard', code.ENCAPSULATED, 'Use takeDamage(500) instead, and see Ada stop at 0.', 'Replace the line that failed with: `ada.takeDamage(500);`'),
      ],
      questions: [
        {
          id: 'why',
          kind: 'choice',
          prompt: 'Why are Player\'s instance variables private?',
          options: [
            { id: 'rules', text: 'So only the class\'s own methods can change them', correct: true },
            { id: 'fast', text: 'So the program runs faster', feedback: 'private has no effect on speed. It is about which code is allowed to use the data.' },
            { id: 'hidden', text: 'So not even Player\'s own methods can read them', feedback: 'Player\'s own methods can use them. takeDamage changes health. private stops other classes.' },
            { id: 'required', text: 'Because Java refuses to compile public variables', feedback: 'Java allows public instance variables. Programmers keep them private on purpose.' },
          ],
          explain: 'With private data, takeDamage is the only way to lower health, so one if statement protects every player in the program.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'fields-ctor',
      title: 'Your first class: Song',
      body: md`
        Now you write the class. Each song in a music app has a title, an artist, and a play count.

        Press **Run** first. You'll get an error, because Main passes two values, and no constructor takes them yet. That's fine. Errors show you what's left.

        Work in **Song.java**. **Player.java** is there to read as a pattern.

        1. Declare three private instance variables, which means naming each one and giving its type: \`title\` and \`artist\` are Strings, and \`plays\` is an int. Follow Player: \`private String name;\`
        2. Write a constructor with two String parameters, \`songTitleIn\` and \`songArtistIn\`. Constructor parameters in this lab end in In, so you can tell them apart from the instance variables.
        3. Inside it, store each parameter in its instance variable, and set \`plays\` to 0. The variable on the left of \`=\` gets the value.

        A **parameter** is a variable that gets its value when the constructor is called. Main passes "Neon Rain", so \`songTitleIn\` holds "Neon Rain".

        Press **Run** after each part. The checks tell you what's left.

        About that first error: a class with no constructor gets a **default constructor** from Java, which takes no values. Once you write your own, Java stops supplying that one.
      `,
      demos: [songEditor],
      goals: [
        passed('song', code.SONG_FIELDS, 'Declare the three private instance variables.', 'Inside the class, above the constructor: `private String title;` and so on. Each line ends with a semicolon.'),
        passed('song', code.SONG_CTOR, 'Write the constructor.', 'A constructor has the same name as the class: `public Song(String songTitleIn, String songArtistIn) { }`'),
        passed('song', code.SONG_SETS, 'Store both values, and start plays at 0.', 'Inside the constructor: `title = songTitleIn;`'),
      ],
      questions: [
        {
          id: 'default-ctor',
          kind: 'choice',
          prompt: 'Read the last paragraph of this step first. Suppose a class has no constructor at all. What does `new Song()` do?',
          options: [
            { id: 'default', text: 'Java supplies a default constructor', correct: true },
            { id: 'error', text: 'It fails to compile, since Song has no constructor', feedback: 'It compiles if the class has no constructor of its own. The error in this step came from Main passing two values.' },
            { id: 'null', text: 'It gives back null instead of an object', feedback: 'new always builds an object. It never gives back null.' },
            { id: 'ask', text: 'Java asks the user to type in the values', feedback: 'Java never asks. Every variable gets a value from the code, or a default.' },
          ],
          explain: 'The default constructor takes no values, so new Song() works. Main needed two values, so it needed a constructor you wrote.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'getters',
      title: 'Accessors: let others read',
      body: md`
        Song's data is private, so Main can't read it. An **accessor** is a method that lets other classes read a value:

        \`\`\`java
        public int getHealth() {
          return health;
        }

        public String getName() {
          return name;
        }
        \`\`\`

        The word before the name, \`int\` or \`String\`, is the **return type**: what kind of value the method gives back. \`return\` ends the method and hands the value to the code that called it.

        To build text, join the parts with \`+\`, and put the spaces inside the quotes: \`name + " has " + health\` gives \`Ada has 70\`.

        Your code from the last step is in **Song.java**. Add two methods below the constructor. Main calls both, so it won't compile until both are there:

        1. \`getPlays()\`, which returns the plays
        2. \`getSummary()\`, which returns one String like this: \`Neon Rain by The Tin Owls, 0 plays\`
      `,
      demos: [{ kind: 'java', id: 'song', title: 'Add accessors to Song', files: code.SONG_GETTERS, from: { step: 'fields-ctor', demo: 'song', files: ['Song.java'] }, checks: getterChecks }],
      goals: [
        passed('song', code.SONG_ACCESSORS, 'Write getPlays.', 'It gives back an int, so it starts: `public int getPlays()`'),
        passed('song', code.SONG_SUMMARY, 'Write getSummary.', '`return title + " by " + artist + ", " + plays + " plays";`'),
      ],
      questions: [
        {
          id: 'caller',
          kind: 'choice',
          prompt: 'Where does the value go when `getPlays()` runs `return plays;`?',
          options: [
            { id: 'caller', text: 'Back to the code that called the method', correct: true },
            { id: 'screen', text: 'To the screen, where the user can read it', feedback: 'return prints nothing. Only System.out.println prints. In Main, the print line is what shows the value.' },
            { id: 'var', text: 'Into the instance variable plays', feedback: 'plays stays the same. return hands back a copy of its value.' },
            { id: 'gone', text: 'Nowhere, since return ends the program', feedback: 'return ends only this method. Then the calling code continues.' },
          ],
          explain: 'A method call stands for the value it returns. In `System.out.println(first.getPlays());` the returned count is what gets printed.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'mutators',
      title: 'Mutators: let others change',
      body: md`
        An **accessor** reads. A **mutator** is a method that changes an instance variable. It is often **void**, which means it gives back no value at all, not even 0.

        Open **Player.java** and find \`takeDamage\`. It is a mutator. Its line \`health = health - amount;\` works out a new value from the old one, then stores it.

        Now add a mutator to **Song.java**: \`public void addPlays(int amount)\` adds \`amount\` to plays. Main already calls it.

        Press **Run** to see the counts change. Press **Step through** to watch each call change only the object before the dot.
      `,
      demos: [{ kind: 'java', id: 'song', title: 'Add a mutator to Song', files: code.SONG_MUTATORS, from: { step: 'getters', demo: 'song', files: ['Song.java'] }, checks: mutatorChecks, step: true, report: true }],
      goals: [
        passed('song', code.SONG_ADD, 'Write addPlays(int amount).', 'Follow takeDamage, but add instead of subtract.'),
      ],
      questions: [
        {
          id: 'void',
          kind: 'choice',
          prompt: 'What happens with the line `int n = first.addPlays(3);`?',
          options: [
            { id: 'error', text: 'It won\'t compile, since addPlays is void', correct: true },
            { id: 'count', text: 'n gets the new play count', feedback: 'addPlays would need a return type of int and a return line for that.' },
            { id: 'zero', text: 'n gets 0, since nothing came back', feedback: 'Java does not fill in a value. A void method has no value at all, so this does not compile.' },
            { id: 'null', text: 'n gets null, since nothing came back', feedback: 'An int can never hold null, and a void method gives back nothing.' },
          ],
          explain: 'Try it if you like: Java says incompatible types: void cannot be converted to int.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'this',
      title: 'Same name, two variables: this',
      body: md`
        Someone wrote this Pet class, and it has a bug. Press **Run**, and look at what it prints.

        Press **Step through**, then press **Stop** once you've seen the constructor's two lines.

        Here is the bug. Both the parameter and the instance variable are called \`name\`, because Pet's author did not use the In ending. Inside the constructor, \`name\` means the parameter, which **hides** the instance variable. So \`name = name;\` copies the parameter onto itself.

        **this** refers to the current object, the one the code is working on. \`this.name\` always means the instance variable. Fix the constructor: write \`this.name = name;\` and do the same for age. Press **Run**.

        **Scope** is the part of the code where a name works. A parameter works only inside its own constructor or method. A **local variable**, one declared inside a method, works only inside the braces that hold it. An instance variable works anywhere in the class.
      `,
      demos: [{ kind: 'java', id: 'pets', title: 'Fix the Pet class', files: code.PET, checks: [code.PET_FIXED], step: true, report: true }],
      goals: [passed('pets', code.PET_FIXED, 'Fix the constructor with this.', '`this.name = name;`')],
      questions: [
        {
          id: 'scope',
          kind: 'choice',
          prompt: 'Pet\'s constructor has a parameter `age`. Can `getSummary` use that parameter?',
          options: [
            { id: 'no', text: 'No. It exists only in the constructor', correct: true },
            { id: 'yes', text: 'Yes. Any code in the class can use it', feedback: 'That is true of instance variables. A parameter is a local variable, so it ends when the constructor ends.' },
            { id: 'public', text: 'Only if the parameter is public', feedback: 'Local variables and parameters can\'t be public or private at all.' },
            { id: 'this', text: 'Yes, if it writes this.age', feedback: 'this.age is the instance variable, and getSummary can use that. The parameter is already gone.' },
          ],
          explain: 'getSummary uses the instance variable age. That is why the constructor has to store the parameter there.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'scratch',
      title: 'On your own: BankAccount',
      body: md`
        Now write a whole class on your own in **BankAccount.java**. **Player.java** is there if you want to check a pattern. **Main.java** is already written, and it uses every part of the class.

        - **Instance variables:** \`owner\`, a String, and \`balance\`, an int. Both private.
        - **Constructor:** Takes the owner and the starting balance. End each parameter's name in In.
        - \`public int getBalance()\` returns the balance.
        - \`public void deposit(int amount)\` adds to the balance.
        - \`public void withdraw(int amount)\` subtracts from the balance, but only if there's enough. Taking out all of it is allowed. If there isn't enough, the balance doesn't change.

        In an if, \`<=\` means less than or equal to.

        Build it one part at a time, and press **Run** after each one. Main won't compile until the class is finished, but the checks count each part as you go.
      `,
      demos: [{ kind: 'java', id: 'bank', title: 'Write the BankAccount class', files: code.BANK, checks: bankChecks, step: true, report: true }],
      goals: [
        passed('bank', code.BANK_CTOR, 'Write the instance variables and the constructor.', 'Song is your pattern: private instance variables, then a constructor with no return type.'),
        passed('bank', code.BANK_WITHDRAW, 'Write getBalance, deposit, and withdraw.', 'In withdraw, use an if: `if (amount <= balance) { ... }`'),
      ],
      questions: [
        {
          id: 'where-rule',
          kind: 'choice',
          prompt: 'Why does the "not below 0" rule go inside withdraw, not in Main?',
          options: [
            { id: 'once', text: 'So it protects every account in any program', correct: true },
            { id: 'must', text: 'Because Main can\'t contain an if statement', feedback: 'Main can use if. But then every program that uses BankAccount would have to remember the rule.' },
            { id: 'faster', text: 'Because code in a class runs faster', feedback: 'Speed is the same. The point is where the rule lives.' },
            { id: 'private', text: 'Because if statements have to be in private methods', feedback: 'withdraw is public, and an if can go in any method.' },
          ],
          explain: 'The class guards its own data. That is data encapsulation at work: one rule, in one place, for every object.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflection',
      body: md`
        Think back to step 1, when you tracked players with separate variables. Your answer below goes to your teacher.
      `,
      questions: [
        {
          id: 'why-class',
          kind: 'text',
          prompt: 'A friend is writing a game with 20 enemies. Explain why they should write an Enemy class. Use the words object, instance variable, and private, and say what a constructor would do.',
          minWords: 40,
          lines: 5,
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.

        Finished early? After you hand in, press **Extra credit** for one more step: a class that holds a list of your Song objects.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'playlist',
      title: 'Extra credit: a Playlist',
      extra: true,
      body: md`
        A class can use other classes. A Playlist **has** Songs, which is called a **has-a** relationship. Its instance variable is an ArrayList of Song objects.

        Here is how the same ideas look with an ArrayList of Pet objects called \`pets\`. Assume Pet has a \`getAge()\` method:

        \`\`\`java
        pets.add(biscuit);

        int total = 0;
        for (Pet p : pets) {
          total = total + p.getAge();
        }
        \`\`\`

        \`add\` puts an item at the end of the list. A **for-each loop** runs once per item, and \`p\` holds that item. \`pets.get(0)\` gives back the first item.

        To find the biggest, keep the best one so far, and replace it when you find a bigger one. With ages 5, 8, and 3, best starts at 5, becomes 8, and stays 8.

        Open **Playlist.java**. The \`import\` line lets the class use ArrayList, and \`<Song>\` says what the list holds. Add three methods:

        1. \`public void add(Song song)\` puts a song on the list.
        2. \`public int getTotalPlays()\` adds up \`getPlays()\` for every song.
        3. \`public Song getMostPlayed()\` returns the song with the most plays. You can assume the list has at least one song.

        Your methods can only reach a Song's private data through its public methods, the same as any other class.
      `,
      demos: [{ kind: 'java', id: 'list', title: 'Write the Playlist class', files: code.PLAYLIST, checks: listChecks, step: true, report: true, from: { step: 'mutators', demo: 'song', files: ['Song.java'] } }],
      goals: [
        passed('list', code.LIST_ADD, 'Write add.', '`songs.add(song);`'),
        passed('list', code.LIST_TOTAL, 'Write getTotalPlays.', 'Start a total at 0, then add each song\'s getPlays() in a for-each loop.'),
        passed('list', code.LIST_MOST, 'Write getMostPlayed.', 'Start with `Song best = songs.get(0);`. In a for-each loop, if a song has more plays than best, store it in best. Compare getPlays() on both. Return best at the end.'),
      ],
    },
  ],
};

