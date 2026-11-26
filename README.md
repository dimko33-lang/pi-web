# Pi Web · Nikita

Nikita is a personal project I’ve wanted to build for twenty years. This is my starting sandbox: a place to try things with the Pi coding agent in a browser and on Telegram. You can install it on your own machine and see what you’d use it for.

The current installable release is [v0.13.0 — One conversation, three ways to reply](https://github.com/dimko33-lang/pi-web/releases/tag/v0.13.0). Fresh installs use its archive; rerunning the card is not a general upgrade command.

**Group memory:** In `/profiles`, enable **Person** at 100 and pause **Group** and **BG** to give Nikita the current participant’s last 100 available dialogue messages in that group, even after the room has moved on. Each switch pauses its source without clearing the number. Only selected context is added to the model request. [How the three windows work, what ships for individual DMs, and the Library of Babel preview](docs/releases/v0.12.0.md).

**Individual Telegram DMs:** From the installed app directory, run `python3 telegram/private_profiles.py USER_ID "Display name"` and restart the panel. This explicitly allows that user to contact the agent and adds a private profile tab. Set its character, base and custom prompts, response style, model, thinking, memory and tools switch on `/profiles`. Until saved, it uses the Other DMs profile. Dialogue limits how many prior messages from that DM reach the model. An explicit reply can still quote its target when automatic history is paused. See [private memory and long replies](docs/usage.md#private-dialogue-and-long-telegram-replies). Guests may request image generation with `/image` when tools are enabled; Python execution and request inspection remain owner-only in private chats. To revoke access, rerun the command with just the ID. Restart the panel to refresh the tabs. Local enrollments, personal prompts and messages are not distributed.

Telegram demo: [PI-WEB Chat](https://t.me/PiWebChat) · [Salon Niki](https://t.me/SalonNikiChat)

**Need to recover the voice name, connect Telegram or maintain the installation?** Open the [local operator handbook](server/handbook/START-HERE.md). The installer prints its path (normally `~/PiWebRuntime/app/server/handbook/START-HERE.md`). In the stock isolated Linux browser workspace the same index is readable at `/opt/app/server/handbook/START-HERE.md` without Root. Ask the maintenance agent to open the index and read only the matching note; these files are not automatically loaded into conversations.

**Nikita's reference voice is already selected for Gemini enrollment.** With your own Google project/key, the bundled [Gacrux setup](server/handbook/voice-output.md) uses `gemini-3.1-flash-tts-preview`, `Gacrux`, and the exact approved third-audition direction (`gacrux-C-v1`). No AI Studio voice selection is required. Enrollment does not turn on cloud replies for every chat. Git supplies the voice recipe and seven starter profiles, not the owner's current Response style or per-chat switches. To reproduce a customized instance, separately keep a private snapshot of `tail`, `tailOn`, `textOutput`, `voiceOutput` per profile and its `/voice_all` default; restore these after enrollment, not the old Telegram session or a shared API key.

## Try it

On macOS or Linux, run this in a terminal. For the full server setup, use a spare Debian or Ubuntu server with systemd and run it as root over SSH.

```sh
curl -fsSL https://dimko33-lang.github.io/pi-web/install.sh | bash
```

On a local Mac, the panel opens in your browser. On a server with public IPv4 and ports 80 and 443 available, the installer sets up HTTPS and prints **Open Nikita:** followed by a reusable link. **It’s an owner link, not a guest invite:** anyone who has it shares the panel and, on the standard Linux server install, can enable Root. Root starts off.

No provider or Telegram login is needed to install or read the Notes. For model replies, run `pi` as the installation user (or use the path the installer prints) and connect your own provider. Telegram is optional and stays offline until you enroll a separate agent account.

## What you can try today

- **Browser chat and salon.** Choose a model and thinking level, edit seven conversation profiles at `/profiles`, or read the 18 bundled Notes at `/nikita/`.
- **Telegram.** Connect your agent with `nikita-telegram connect`, set the owner, then choose the chats. Archiving a group does not give Nikita permission to speak there. Group text replies and the LightCone author archive are separate opt-ins. You start with empty archives, not someone else’s conversations. Tag Nikita on a GIF or video and a vision-capable model can see ordered samples, without audio. Supported Telegram attachments may be up to 4 GiB; models receive a bounded image or text preview, not the entire file. Send a Russian voice note or speech file in the owner DM or address Nikita in a reply-enabled group. You can also mention her in a reply directly to the recording. Russian speech is recognized locally with GigaAM v3; no extra API key or GPU. In any conversation where Nikita already answers, address her and start with `Поговори со мной` for one cloud voice note. Fresh installs use the public Qwen3-TTS demo; optionally connect your own Google AI Studio project for Gemini's mature Gacrux voice (see [setup](docs/usage.md#optional-google-gacrux-voice)). Only the short final answer is sent for synthesis, not the incoming recording. Once Gacrux is connected, the owner can ask for voice by default in every admitted chat with `/voice_all on` in the owner DM (`/voice_all off` restores the instance default to text). On each conversation profile, save **Text**, **Voice**, or both to match the incoming message. Leave both off to follow the instance default. With Voice selected, short answers go to Google Gacrux; if synthesis is unavailable the answer is delivered as text. Press **Save** to apply a profile change. Leave confidential replies as text. Irina is not an automatic fallback.
- **Science and images.** On the standard Linux server install, try `/science print(2 ** 32)` to run Python in an offline container. Ask for an image or a photo edit if your selected provider supports it. Nikita won’t switch to another billing provider to make it work.
- **Request JSON.** In `My DM`, you can explicitly arm a one-shot check to see what Pi prepares to send to the provider for a test `ok`. It’s off by default, never watches groups, and expires after ten minutes. Anyone with panel access can see the captured body until it is cleared or expires.
- **Save.** Export a restorable copy of the application, including the 18 Notes. It’s not a server backup: it doesn’t include chat history, personal settings, Telegram sessions or provider credentials.

This installer doesn’t yet reproduce everything on the working Nikita server. In particular, group attachments, group-specific tools and the exact choice of conversation history still differ. On the stock server install, **after a reboot, rerun the install command to bring the panel and HTTPS back**. That’s separate from the enrolled Telegram service.

## Run the offline checks

With Node 22.23.4, `npm ci && npm test` checks source export/restore, profile settings and the tool adapter using disposable fixtures. No Pi or Telegram login is required. For the Telegram regressions, set `TEST_TELEGRAM_PYTHON` to a Python with `telegram/requirements.lock` installed and `TEST_PI_BIN` to a compatible Pi executable, then run `npm run test:telegram`. This checks the actual provider payload on loopback, not a live account. To time a real Pi turn beyond six minutes, run `"$TEST_TELEGRAM_PYTHON" -B tests/turn-wait.py --long` with `TEST_PI_BIN` still set.

## Credits and license

Pi Web is an independent browser and Telegram interface for [Pi](https://pi.dev/), not an official Pi release. Thank you, [Mario Zechner](https://mariozechner.at/), for building the coding agent that made Nikita possible.

The original Pi Web code is [MIT licensed](LICENSE). Pi, third-party libraries, fonts and models retain their own licenses; the code license does not cover Notes articles or media. See [third-party notices](docs/licenses/README.md).

[Installation card](https://dimko33-lang.github.io/pi-web/) · [Setup, permissions and removal](docs/usage.md) · [Restore from Save](RESTORE.md) · [What matches the working server](docs/reference-install.md)
