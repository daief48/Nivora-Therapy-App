// Strings for the turn-based listening path (phone recogniser / server transcription). Every key must exist in BOTH objects.
export const en = {
  vpUnsupportedLang: 'Your phone cannot listen in this language, so I am using the online listener.',
  vpNoNetwork: 'I cannot hear you without an internet connection. You can type instead.',
  vpDenied: 'The microphone is turned off for Nivora. You can allow it in Settings, or type instead.',
  vpFailed: 'I could not listen just now. Please try again or type instead.',
  vpHeardNothing: 'I did not catch that. Please say it again.',
} as const;
export const bn: Record<keyof typeof en, string> = {
  vpUnsupportedLang: 'আপনার ফোন এই ভাষায় শুনতে পারে না, তাই অনলাইন শ্রবণ ব্যবহার করছি।',
  vpNoNetwork: 'ইন্টারনেট ছাড়া আমি আপনার কথা শুনতে পারছি না। আপনি লিখে জানাতে পারেন।',
  vpDenied: 'নিভোরার জন্য মাইক্রোফোন বন্ধ আছে। সেটিংসে অনুমতি দিন, অথবা লিখে জানান।',
  vpFailed: 'এখন শুনতে পারিনি। আবার চেষ্টা করুন অথবা লিখে জানান।',
  vpHeardNothing: 'আমি ঠিক শুনতে পাইনি। অনুগ্রহ করে আবার বলুন।',
};
