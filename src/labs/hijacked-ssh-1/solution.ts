import type { LabSolution } from '../solution';

/**
 * Sample answers, so the walkthrough test and the click-through can fill in
 * every box. They are for the tests only, not an answer key: nobody checked
 * them against the range, and addresses, logins, and passwords come from each
 * student's range and capture.
 */
export const hijackedSsh1Solution: LabSolution = {
  recon: {
    text: {
      a1: '10.29.128.46',
      a5: 'ubuntu / letmein',
      a7: 'SSH refuses the connection with "Permission denied (publickey)" because the server only takes a key, and I do not have one yet.',
    },
  },
  key: {
    text: {
      b1: 'security.db',
      b2: 'It lists user accounts and settings in plain text. It mentions an SSH key and where the user keeps it, which hints that a key exists.',
      b5: 'The user should never have sent the private key over plain HTTP. A private key should stay on its own computer, or be moved over an encrypted channel like SCP or SFTP.',
    },
  },
  john: {
    text: {
      c1: 'After three wrong passphrases, SSH gives up and the connection is refused.',
      c5: 'sunshine1',
      c6: 'The key unlocks and I get a shell on the Ubuntu machine as the ubuntu user.',
    },
  },
  together: {
    text: {
      d1: 'They used FTP and HTTP, which send everything in plain text. They put the private key where anyone on the network could download it. They protected the key with a weak password from a common word list.',
      d2: 'FTP sends logins and files in plain text, so anyone capturing traffic can read them. The security.db file showed account details and pointed to the SSH key.',
      d3: 'With an encrypted transfer like SCP or SFTP, or better, by making a new key pair on the new computer and copying only the public key.',
    },
  },
};
