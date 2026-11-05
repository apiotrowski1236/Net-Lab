/** A plain-English line for an exception that stopped a program. */
export function runtimeHelp(short: string): string {
  switch (short) {
    case 'NullPointerException':
      return 'A variable here holds null, so there is no object to use. The message below names the variable. Make sure it got an object from new first.';
    case 'ArrayIndexOutOfBoundsException':
      return 'This array has no spot at that index. Spots start at 0, and the last one is length - 1.';
    case 'IndexOutOfBoundsException':
      return 'This list has no item at that index. Items start at 0, and the last one is size() - 1.';
    case 'StringIndexOutOfBoundsException':
      return "That position is outside this String. Positions start at 0, and the last one is length() - 1.";
    case 'ArithmeticException':
      return 'This code divides an int by zero, which has no answer. Check the value on the right of / or %.';
    case 'ClassCastException':
      return 'This cast says an object is a different class than it really is.';
    case 'NumberFormatException':
      return "This text isn't a number, so it can't be turned into one.";
    case 'StackOverflowError':
      return 'A method kept calling itself and never stopped. Check that it has a way to finish.';
    case 'ConcurrentModificationException':
      return "A for loop like for (Song s : songs) can't add to or remove from the list it's going through. Use a for loop with an index instead.";
    case 'NegativeArraySizeException':
      return "An array can't have a negative size.";
    default:
      return 'The program stopped here with an error. The first line below says what went wrong.';
  }
}
