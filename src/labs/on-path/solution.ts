import type { LabSolution } from '../solution';
import { IP, MAC } from './scenario';

/** Answer key for "On-Path Attacks: Sniffing and ARP Poisoning". Choice answers come from the lab itself. */
export const onPathSolution: LabSolution = {
  welcome: { moves: [{ inspect: 'alice' }, { inspect: 'mallory' }] },
  normal: { moves: [{ press: 'login' }] },
  sniff: {
    moves: [{ tool: { type: 'sniff', device: 'mallory', on: true } }, { press: 'login' }, { openFrame: 'mallory', match: 'login' }],
    text: { password: 'pumpkinspice' },
  },
  why: {
    text: {
      unnoticed:
        'Mallory only listened. She never sent anything or changed any packet, so the page loaded the same way it always does and nothing looked different to Alice.',
    },
  },
  wpa2: { moves: [{ press: 'login' }, { inspect: 'wifi' }] },
  arp: { moves: [{ inspect: 'alice' }] },
  poison: {
    moves: [
      { tool: { type: 'arp-spoof', device: 'mallory', victim: 'alice', claimIp: IP.router } },
      { tool: { type: 'arp-spoof', device: 'mallory', victim: 'router', claimIp: IP.alice } },
    ],
  },
  broken: { moves: [{ press: 'login' }] },
  relay: {
    moves: [{ tool: { type: 'forward', device: 'mallory', on: true } }, { press: 'login' }],
    text: {
      compare:
        'In step 3 Mallory only listened because open Wi-Fi sent her every frame. With WPA2 she had to send forged ARP replies so Alice and the router delivered their frames to her, and she had to forward them so the connection kept working and Alice would not notice.',
    },
  },
  https: { moves: [{ press: 'login-https' }, { openFrame: 'mallory', match: 'encrypted' }] },
  detect: {
    moves: [
      { inspect: 'router' },
      { tool: { type: 'static-arp', device: 'alice', ip: IP.router, mac: MAC.router } },
      { tool: { type: 'arp-spoof', device: 'mallory', victim: 'alice', claimIp: IP.router } },
    ],
  },
  defenses: {
    text: {
      'pick-one':
        'I would pick HTTPS on every site. It keeps passwords and page contents secret even when someone sniffs open Wi-Fi or gets in the middle with ARP poisoning. It does not stop ARP poisoning itself, so Mallory can still break Alice’s connection or see which sites she visits and when.',
    },
  },
};
