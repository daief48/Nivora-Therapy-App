// Strings for the "platform" feature area. Owned by one feature agent. Every key must exist in BOTH objects.
export const en = {
  platAnalyticsTitle: 'Help improve Nivora',
  platAnalyticsBody: 'Share anonymous usage counts, like which screens are used. We never send anything you write, your name, or your messages. The anonymous ID changes every day, so it cannot be linked to you. It is off unless you turn it on, and you can turn it off any time.',
  platAnalyticsToggle: 'Share anonymous usage data',
} as const;
export const bn: Record<keyof typeof en, string> = {
  platAnalyticsTitle: 'নিভোরাকে আরও ভালো করতে সাহায্য করুন',
  platAnalyticsBody: 'কোন স্ক্রিন কতবার ব্যবহার হচ্ছে, এমন নামহীন ব্যবহারের হিসাব পাঠাতে পারেন। আপনার লেখা কিছু, আপনার নাম বা বার্তা আমরা কখনোই পাঠাই না। নামহীন আইডি প্রতিদিন বদলে যায়, তাই এটি আপনার সঙ্গে জোড়া লাগানো যায় না। আপনি চালু না করলে এটি বন্ধ থাকে, আর যখন খুশি বন্ধ করতে পারেন।',
  platAnalyticsToggle: 'নামহীন ব্যবহারের তথ্য পাঠান',
};
