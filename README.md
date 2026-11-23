# Pi Web · Nikita

Nikita is a personal project I’ve wanted to build for twenty years. This is my starting sandbox: a place to try things with the Pi coding agent in a browser and on Telegram. You can install it on your own machine and see what you’d use it for.

The current installable release is [v0.9.2](https://github.com/dimko33-lang/pi-web/releases/tag/v0.9.2). Fresh installs use its archive; rerunning the card is not a general upgrade command.

[Nikita on Telegram](https://t.me/+n4lYVtZb0RE4NGE6)

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

[Installation card](https://dimko33-lang.github.io/pi-web/) · [Setup, permissions and removal](docs/usage.md) · [Restore from Save](RESTORE.md) · [What matches the working server](docs/reference-install.md)
