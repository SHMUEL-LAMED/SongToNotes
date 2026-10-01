import type { TourStep } from "./types";

/** Tours of the tools that read a song: notes, tempo and key, chords, song identification and ringtones. */
export const ANALYSIS_TOURS: Record<string, TourStep[]> = {
  notes: [
    {
      target: ".workspace-section .drop-zone, .workspace-section .selected-file",
      title: "בוחרים שיר",
      text: "גוררים לכאן שיר או לוחצים לבחירת קובץ. התוצאה הטובה ביותר מתקבלת מכלי נגינה יחיד או משירה נקייה.",
    },
    {
      target: ".workspace-section .source-alternatives",
      title: "הקלטה או דוגמה",
      text: "במקום קובץ אפשר ללחוץ „הקלט מהמיקרופון” ולזמזם או לנגן, או „נסה מנגינת דוגמה” כדי לראות איך זה עובד.",
    },
    {
      target: ".workspace-section .waveform",
      title: "סימון קטע",
      text: "אחרי שהשיר נטען מופיע גל הקול. מסמנים בו קטע בגרירה כדי להפוך לתווים רק אותו — נוח בשיר ארוך.",
    },
    {
      target: ".workspace-section .settings-panel",
      title: "הגדרות זיהוי",
      text: "בוחרים „מנגינה ראשית” או „כל התווים”, קובעים רגישות, ובוחרים מנוע „מהיר” או „מעמיק” — המעמיק עשוי להימשך כמה דקות.",
    },
    {
      target: '[data-tour="notes-start"], .workspace-section .processing-box',
      title: "„הפוך את השיר לתווים”",
      text: "לוחצים כדי להתחיל, ועוקבים אחרי פס ההתקדמות; „בטל” עוצר באמצע. התוצאה נשמרת אוטומטית באזור האישי.",
    },
    {
      target: ".results-section .stats-grid",
      title: "התוצאה",
      text: "בסיום מופיעים מספר התווים, הקצב, הסולם, המשך ומספר התיבות. למעלה, „ללמוד בפסנתר” פותח שיעור בפסנתר הווירטואלי ו„שיר חדש” מתחיל מחדש.",
    },
    {
      target: ".results-section .playback-card",
      title: "השמעה",
      text: "„נגן את התוצאה” משמיע את התווים בכלי ובמהירות שבוחרים, עם מטרונום או לולאה על הקטע המסומן. רווח מנגן ומשהה, החצים מדלגים ו־Esc עוצר.",
    },
    {
      target: ".results-section .refine-panel",
      title: "כוונון התוצאה",
      text: "ניקוי הרמוניות, אורך תו מזערי, יישור לרשת, משקל, קצב וטרנספוזיציה — כל שינוי מתעדכן מיד, בלי לנתח שוב.",
    },
    {
      target: ".results-section .result-toolbar",
      title: "ארבע תצוגות",
      text: "עוברים בין „תווים”, „Piano Roll”, „רשימת תווים” ו„טאבים”. בתצוגת התווים יש כפתורים להדפסה ולהעתקת קוד ABC.",
    },
    {
      target: ".results-section .downloads-card",
      title: "הורדת התוצאה",
      text: "מורידים MusicXML ל־MuseScore, MIDI לתוכנות אולפן, תמונת תווים, PDF להדפסה, טאבים לגיטרה, ABC או CSV עם כל התווים.",
    },
  ],

  analyze: [
    {
      target: ".analyze-tool .drop-zone, .analyze-tool .selected-file",
      title: "בוחרים שיר",
      text: "גוררים לכאן שיר או לוחצים לבחירת קובץ. הניתוח מתחיל מיד, בלי כפתור נוסף.",
    },
    {
      target: ".analyze-tool .source-alternatives",
      title: "או מקליטים",
      text: "„הקלט מהמיקרופון” מקליט ישירות לכלי, וההקלטה נשארת במכשיר.",
      optional: true,
    },
    {
      target: ".analyze-tool .analyze-stats",
      title: "קצב וסולם",
      text: "אחרי הניתוח מופיעים הקצב ב־BPM עם החצי והכפול שלו, והסולם עם הסולם היחסי. ליד כל אחד כתוב כמה הזיהוי בטוח.",
    },
    {
      target: ".analyze-tool .analyze-stats .stat-card:nth-child(3)",
      title: "Camelot ועוצמה",
      text: "קוד Camelot עוזר למצוא שירים שמתחברים יפה במיקס. לצידו המשך והעוצמה הממוצעת של השיר.",
    },
    {
      target: ".analyze-tool .chroma-card",
      title: "פרופיל הצלילים",
      text: "כמה כל תו נוכח לאורך השיר. העמודות של תווי הסולם צבועות, והטוניקה מודגשת.",
    },
    {
      target: ".analyze-tool .save-work",
      title: "שמירה",
      text: "„שמור את הניתוח” שומר את התוצאה באזור האישי, כדי לחזור אליה בלי לבחור את השיר שוב.",
    },
    {
      target: ".analyze-tool .send-file-menu",
      title: "„לכלי אחר”",
      text: "הכפתור ליד שם הקובץ פותח את אותו שיר בכלי אחר באתר, בלי להעלות אותו שוב — למשל ב„שיר לתווים” לתווים מלאים.",
    },
  ],

  chords: [
    {
      target: ".chords-tool .drop-zone, .chords-tool .selected-file",
      title: "בוחרים שיר",
      text: "גוררים לכאן שיר, לוחצים לבחירה או „הקלט מהמיקרופון”. שיר עם ליווי ברור נותן את התוצאה הטובה ביותר, והזיהוי מתחיל לבד.",
    },
    {
      target: ".chords-tool .settings-panel",
      title: "טרנספוזיציה וקאפו",
      text: "אחרי הזיהוי מזיזים את השיר לסולם נוח לשירה, ומציבים קאפו כדי לקבל אחיזות פשוטות יותר. אפשר גם לבחור „שמות עם במול”.",
    },
    {
      target: ".chords-tool .transport, .chords-tool .chords-now",
      title: "נגן עם האקורדים",
      text: "לוחצים „נגן עם האקורדים”, והאקורד שמתנגן מופיע בגדול עם האחיזה שלו ועם האקורד הבא.",
    },
    {
      target: ".chords-tool .chords-timeline",
      title: "ציר האקורדים",
      text: "כל האקורדים לפי הסדר, עם זמן ההתחלה. לחיצה על אקורד קופצת לרגע הזה בשיר ומנגנת ממנו.",
    },
    {
      target: ".chords-tool .chords-diagrams",
      title: "דיאגרמות אחיזה",
      text: "האחיזה לגיטרה של כל אקורד בשיר. האקורד שמתנגן עכשיו מודגש.",
    },
    {
      target: ".chords-tool .downloads-card",
      title: "דף אקורדים",
      text: "„TXT” מוריד דף אקורדים עם הזמנים, „העתק” מעתיק אותו, ו„לשירון” פותח אותו בשירון כדי להוסיף מילים. אפשר גם לשתף.",
    },
    {
      target: ".chords-tool .save-work",
      title: "שמירה",
      text: "„שמור את האקורדים” שומר אותם באזור האישי. השיר עצמו לא נשמר, רק האקורדים.",
    },
    {
      target: ".chords-tool .explain-song",
      title: "תסביר לי את השיר",
      text: "„הסבר” נותן בשפה פשוטה את הסולם, המהלך וטיפים לנגינה. לשרת נשלח רק רצף האקורדים, והפעולה עולה קרדיטים.",
    },
  ],

  identify: [
    {
      target: ".identify-tool .transcript-signin",
      title: "מתחברים",
      text: "הזיהוי נעשה בשרת, ולכן צריך חשבון. לוחצים „התחברות עם Google” — זה בחינם.",
      optional: true,
    },
    {
      target: ".identify-tool .identify-listen",
      title: "„האזן למה שמתנגן”",
      text: "לוחצים ומקרבים את המכשיר למקור הצליל. ההאזנה נעצרת לבד אחרי כ־20 שניות, ולחיצה נוספת עוצרת מוקדם.",
    },
    {
      target: ".identify-tool .identify-file",
      title: "„או בחר קובץ”",
      text: "אפשר גם לבחור קובץ שמע או וידאו. נבדקים ממנו עד שלושה קטעים שונים, עד שאחד מהם מזוהה.",
    },
    {
      target: ".identify-tool .identify-actions .credit-cost",
      title: "עלות",
      text: "כל זיהוי עולה קרדיטים פעם אחת, גם כשנבדקו כמה קטעים.",
    },
    {
      target: ".identify-tool .identify-result",
      title: "התוצאה",
      text: "אחרי הזיהוי מופיעים שם השיר, האמן והאלבום, קישורים להאזנה, ולפעמים גם הסרטון מ־YouTube לניגון ישר בדף.",
    },
    {
      target: ".identify-tool .identify-retry",
      title: "לא זוהה?",
      text: "כשלא נמצא שיר מופיע „נסה שוב בקטע אחר”: מקובץ נבדקים קטעים אחרים, ומהמיקרופון מאזינים מחדש.",
    },
    {
      target: ".identify-tool .identify-next",
      title: "ממשיכים עם הקובץ",
      text: "כששיר זוהה מקובץ, שולחים את אותו קובץ בלחיצה ל„מזהה אקורדים”, ל„מילים מסונכרנות” או ל„שיר לתווים”.",
    },
    {
      target: ".identify-tool .identify-history",
      title: "זוהו לאחרונה",
      text: "השירים שזוהו נשמרים באזור האישי ומופיעים כאן ברשימה, עם קישור ל־YouTube כשיש.",
    },
  ],

  ringtone: [
    {
      target: ".ringtone-tool .drop-zone, .ringtone-tool .selected-file",
      title: "בוחרים שיר",
      text: "גוררים לכאן שיר או לוחצים לבחירת קובץ. הצלצול ייחתך מהקובץ הזה.",
    },
    {
      target: ".ringtone-tool .section-picker",
      title: "איזה קטע?",
      text: "אחרי הטעינה האתר מחפש את הפזמון ומציע קטע. אפשר לעבור ל„הבית שזוהה” או ל„קטע מוזיקלי”.",
    },
    {
      target: ".ringtone-tool .waveform",
      title: "גל הקול",
      text: "לחיצה על גל הקול מזיזה את הקטע לשם באותו אורך, גרירה מסמנת קטע חדש, ומשיכת הקצוות משנה את הגבולות.",
    },
    {
      target: ".ringtone-tool .trim-fields",
      title: "התחלה וסיום",
      text: "אפשר להקליד זמנים מדויקים בשניות. צלצול ארוך מ־40 שניות מסומן — לאייפון כדאי לקצר.",
    },
    {
      target: ".ringtone-tool .fine-tune",
      title: "כוונון עדין",
      text: "מזיזים את ההתחלה בשנייה או בעשירית, קובעים אורך במחוון, ו„התאם להתחלה ולסיום טבעיים” מיישר את הקצוות להפסקות בקול.",
    },
    {
      target: ".ringtone-tool .settings-panel",
      title: "כניסה ויציאה רכות",
      text: "מעמעמים את ההתחלה והסוף, משנים עוצמה, ו„איזון עוצמה” מגביר את הצלצול עד לשיא בלי עיוות.",
    },
    {
      target: ".ringtone-tool .transport",
      title: "„השמע את הצלצול”",
      text: "מאזינים לצלצול בדיוק כמו שירד, עם העמעומים והעוצמה.",
    },
    {
      target: ".ringtone-tool .ai-separator",
      title: "צלצול בלי שירה",
      text: "„הפק גרסה אינסטרומנטלית” מפריד את השירה בדפדפן, ואז מסמנים „חתוך את הצלצול מהגרסה האינסטרומנטלית”. הפעם הראשונה עשויה להימשך כמה דקות.",
    },
    {
      target: ".ringtone-tool .downloads-card",
      title: "הורדה ושמירה",
      text: "„WAV” מוריד את הצלצול, „שתף” שולח לוואטסאפ או לקבצים, ו„שמור באזור האישי” שומר אותו בחשבון.",
    },
    {
      target: ".ringtone-tool .downloads-card",
      title: "לטלפון",
      text: "באנדרואיד מעבירים את הקובץ לתיקיית Ringtones. באייפון מייבאים אותו דרך GarageBand או iTunes.",
    },
  ],
};
