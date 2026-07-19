export enum EBotReplyCategory {
    Sarcasm = 'sarcasm',
    Happy = 'happy',
    Angry = 'angry',
}

export type TBotReply = {
    text: string;
    category: EBotReplyCategory;
};
