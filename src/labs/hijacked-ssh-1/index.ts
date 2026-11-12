import type { LabDef, QuestionDef } from '../types';

/**
 * Answer sheet for CYBER.ORG's "Lab 3.1 - Hijacked SSH and Mitigation Part 1"
 * (AP Cybersecurity). Students do the lab on the CYBER.ORG Range from the
 * handout and type their answers here: one question per numbered handout item
 * that asks for something, labeled with the handout's number, so the report
 * reads like the handout. Every answer is teacher-graded. The handout's
 * instructions stay on the handout. See PLAN.md.
 */

/** A one-line answer: an address, a file name, a password. */
const short = (id: string, label: string, prompt: string, placeholder: string): QuestionDef => ({ id, label, kind: 'text', prompt, short: true, placeholder });

/** A written answer, in a box `lines` tall that grows as they type. */
const long = (id: string, label: string, prompt: string, lines = 3): QuestionDef => ({ id, label, kind: 'text', prompt, lines });

export const hijackedSsh1Lab: LabDef = {
  id: 'hijacked-ssh-1',
  version: 1,
  title: 'Lab 3.1 - Hijacked SSH and Mitigation Part 1',
  tagline: 'How can poor security practices lead to a compromised cryptographic key being used to establish an SSH session?',
  unit: 3,
  codehs: [],
  ced: [],
  minutes: 45,
  objectives: [],
  worksheet: { where: 'the CYBER.ORG Range', link: { label: 'CYBER.ORG Range', url: 'https://apps.cyber.org' } },
  steps: [
    {
      id: 'recon',
      title: 'A. Examine the Recon File',
      body: '',
      questions: [
        short('a1', 'A1', 'Run `hostname -I` on the Ubuntu machine. Write what it shows.', 'The address it shows'),
        short('a5', 'A5', 'FTP needs a login, and the capture caught it. What is the username and password?', 'Username and password'),
        long('a7', 'A7', 'From Kali, you ran `ssh ubuntu@<Your-Ubuntu-IP-Address>` and typed **yes** at the security prompt. What happens?'),
      ],
    },
    {
      id: 'key',
      title: 'B. Looking for the Key',
      body: '',
      questions: [
        short('b1', 'B1', 'A file was transferred over FTP. What is the name of the file?', 'File name'),
        long('b2', 'B2', 'You followed the TCP stream for **security.db**. What type of information is in the file, and are there signs that it contains a cryptographic key?', 4),
        long('b5', 'B5', 'The TCP stream for **id_rsa** shows the private key in plain text. How could this have been prevented?', 4),
      ],
    },
    {
      id: 'john',
      title: 'C. Using John the Ripper (JtR) and the RSA Key',
      body: '',
      questions: [
        long('c1', 'C1', 'With the key saved, the Ubuntu machine asks for a password when you connect. You tried a few guesses. What happens after a few attempts?'),
        short('c5', 'C5', 'John the Ripper cracked the hash in **id_rsa_hash**. What is the password?', 'The password John the Ripper found'),
        long('c6', 'C6', 'You connected with SSH again and typed the password from John the Ripper. What happens?'),
      ],
    },
    {
      id: 'together',
      title: 'D. Putting It All Together',
      body: '',
      questions: [
        long('d1', 'D1', 'What are some of the mistakes the Ubuntu user made that could be considered insecure?', 5),
        long('d2', 'D2', 'Why should you not use FTP? What information could be gained from the **security.db** file?', 5),
        long('d3', 'D3', 'How should the key have been moved or transferred if needed?', 5),
      ],
    },
    { id: 'submit', title: 'Hand it in', kind: 'submit', body: '' },
  ],
};
