// Strings for the "voice" feature area. Owned by one feature agent. Every key must exist in BOTH objects.
export const en = {
  voiceReconnecting: 'Connection lost. Reconnecting…',
  voiceLive: 'Live voice. You can speak over me any time.',
  voiceFallback: 'Live voice is not available right now, so I am using the standard voice.',
  voiceCrisisNote: 'If you might be in danger, please tap Emergency now. I am an AI and cannot call anyone for you.',
  voiceMicNeeded: 'Live voice needs the microphone. You can type instead.',
} as const;
export const bn: Record<keyof typeof en, string> = {
  voiceReconnecting: 'সংযোগ বিচ্ছিন্ন হয়েছে। আবার সংযোগ করা হচ্ছে…',
  voiceLive: 'লাইভ ভয়েস চালু। আপনি যেকোনো সময় আমার কথার মাঝে কথা বলতে পারেন।',
  voiceFallback: 'এখন লাইভ ভয়েস পাওয়া যাচ্ছে না, তাই সাধারণ ভয়েস ব্যবহার করছি।',
  voiceCrisisNote: 'আপনি বিপদে থাকতে পারেন মনে হলে এখনই “জরুরি” বোতামে চাপ দিন। আমি একটি AI, আপনার হয়ে কাউকে ফোন করতে পারি না।',
  voiceMicNeeded: 'লাইভ ভয়েসের জন্য মাইক্রোফোন লাগবে। চাইলে আপনি টাইপ করতে পারেন।',
};
