import type { TourStep } from "./types";

/** Tours of the practice tools: tuner, metronome, piano, ear, rhythm, chord changes and theory. */
export const PRACTICE_TOURS: Record<string, TourStep[]> = {
  tuner: [
    {
      target: ".tool-body.tuner .tuner-stage",
      title: "המחוג והתו",
      text: "כאן מופיעים התו שנקלט, הסטייה בסנטים והתדר. „מכוון ✓” מופיע כשהסטייה עד 5 סנט; אחרת כתוב אם למתוח או לשחרר.",
    },
    {
      target: ".tool-body.tuner .metronome-actions",
      title: "התחלת האזנה",
      text: "לוחצים על „התחל להאזין”, מאשרים לדפדפן גישה למיקרופון ומנגנים צליל אחד ליד המכשיר. „עצור האזנה” סוגר את המיקרופון.",
    },
    {
      target: '.tool-body.tuner [data-tour="tuner-instrument"]',
      title: "בחירת כלי",
      text: "„כרומטי” מזהה כל תו. בגיטרה, בס, יוקללה, כינור או צ׳לו המחוג מודד מול המיתר הקרוב ביותר, כך שגם מיתר רפוי מאוד לא יזוהה כתו אחר.",
    },
    {
      target: '.tool-body.tuner [data-tour="tuner-reference"]',
      title: "כיוון הלה",
      text: "הסליידר קובע את תדר הלה (A4), בין 430 ל־450 Hz. 440 הוא התקן; תזמורות מסוימות מכוונות ל־442.",
    },
    {
      target: ".tool-body.tuner .string-row",
      title: "צלילי ייחוס",
      text: "כשנבחר כלי מופיעים כאן המיתרים שלו. לחיצה על מיתר משמיעה את הצליל שלו, ולחיצה נוספת עוצרת. המיתר שנקלט מסומן.",
    },
    {
      target: ".tool-body.tuner .save-work-button",
      title: "שמירת הכיוון",
      text: "„שמור את הכיוון” שומר באזור האישי את הכלי ואת תדר הלה, כדי לפתוח את המכוון כך בפעם הבאה.",
    },
  ],

  metronome: [
    {
      target: ".tool-body.metronome .bpm-readout",
      title: "קביעת הקצב",
      text: "„−” ו„+” משנים את הקצב ב־1 BPM, והסליידר שמתחת מזיז אותו בין 30 ל־260. ליד המספר מופיע שם הטמפו, כמו Andante או Allegro.",
    },
    {
      target: ".tool-body.metronome .beat-dots",
      title: "פעמות התיבה",
      text: "נקודה לכל פעמה בתיבה, והראשונה מודגשת כמו הקליק שלה. בזמן הנגינה נדלקת הנקודה של הפעמה הנוכחית והמטוטלת זזה.",
    },
    {
      target: ".tool-body.metronome .metronome-actions .primary-button",
      title: "הפעלה",
      text: "„הפעל” מתחיל ו„עצור” עוצר. בזמן הנגינה המטרונום מבקש מהמסך להישאר דולק, בדפדפנים שמאפשרים זאת.",
    },
    {
      target: ".tool-body.metronome .metronome-actions .secondary-button",
      title: "טאפ־טמפו",
      text: "לא יודעים את הקצב? מקישים על „טאפ־טמפו” כמה פעמים בקצב השיר, והקצב נקבע לפי ממוצע ההקשות.",
    },
    {
      target: ".tool-body.metronome .settings-panel",
      title: "משקל, חלוקה וצליל",
      text: "בוחרים משקל (2/4 עד 7/8), חלוקת משנה שמוסיפה קליקים חלשים בין הפעמות, צליל (קליק, עץ או ביפ) ועוצמה. ההגדרות נזכרות במכשיר.",
    },
    {
      target: ".tool-body.metronome .preset-strip",
      title: "קצבים נפוצים",
      text: "לחיצה אחת קופצת לקצב עגול: 60, 80, 100 ועד 180 BPM.",
    },
    {
      title: "קיצורי מקלדת",
      text: "רווח מפעיל ועוצר, החצים למעלה ולמטה משנים ב־1 BPM (עם Shift ב־10), ו־T הוא טאפ־טמפו.",
    },
    {
      target: ".tool-body.metronome .save-work-button",
      title: "שמירת הקצב",
      text: "„שמור את הקצב” שומר באזור האישי את הקצב, המשקל, החלוקה והצליל, כדי לחזור אליהם בלחיצה.",
    },
  ],

  piano: [
    {
      target: ".piano-tool .piano-keys",
      title: "המקלדת",
      text: "מנגנים בעכבר או במגע, ואפשר להחליק על המקשים. על כל מקש כתוב שם התו והאות שמנגנת אותו במקלדת המחשב.",
    },
    {
      target: ".piano-tool .piano-keys",
      title: "נגינה מהמקלדת",
      text: "שורת המקשים A, W, S, E… מנגנת את הפסנתר, גם כשהמקלדת בעברית. Z ו־X מזיזים אוקטבה, ורווח מוחזק הוא פדל סוסטיין.",
    },
    {
      target: ".piano-tool .piano-status",
      title: "מה מנוגן",
      text: "כאן מופיעים שמות התווים שלוחצים עליהם ברגע זה, ובזמן הקלטה גם כמה תווים נרשמו.",
    },
    {
      target: ".piano-tool .piano-controls .segmented-control",
      title: "אוקטבה ופדל",
      text: "„אוקטבה −” ו„אוקטבה +” מזיזים את טווח המקשים, ו„פדל סוסטיין” משאיר את הצלילים מהדהדים אחרי שמרפים.",
    },
    {
      target: ".piano-tool .piano-controls button[title]",
      title: "בקר MIDI",
      text: "„חיבור בקר MIDI” מאפשר לנגן ממקלדת MIDI שמחוברת למחשב.",
      optional: true,
    },
    {
      target: '.piano-tool [data-tour="piano-record"]',
      title: "הקלטה",
      text: "„הקלט נגינה” מתחיל לרשום כל מה שמנגנים, ו„עצור הקלטה” מסיים.",
    },
    {
      target: ".piano-tool .piano-controls .primary-button, .piano-tool .save-work-button",
      title: "הורדה ושמירה",
      text: "אחרי ההקלטה מופיעים „הורד MIDI”, שמוריד קובץ לתוכנות מוזיקה, ו„שמור את ההקלטה” בראש העמוד, ששומר אותה באזור האישי.",
    },
    {
      target: ".piano-tool .piano-lesson, .piano-tool .piano-lesson-tip",
      title: "לימוד שיר",
      text: "ב„שיר לתווים” לוחצים „ללמוד בפסנתר” והתווים נופלים על המקשים. ב„צפייה” השיר מתנגן לבד; ב„תרגול” הוא מחכה שמנגנים את המקשים המוארים.",
    },
    {
      target: ".piano-tool .settings-panel",
      title: "צליל ותצוגה",
      text: "בוחרים צליל (פסנתר, אורגן או סינת׳), מדגישים סולם על המקשים לפי טוניקה וסוג, ובוחרים 2 או 3 אוקטבות, עוצמה ושמות תווים.",
    },
  ],

  ear: [
    {
      target: ".ear-training .settings-panel",
      title: "בחירת תרגיל",
      text: "בוחרים תרגיל — מרווחים, אקורדים או דרגות בסולם — ורמה. במרווחים בוחרים גם אם הצלילים יתנגנו „בזה אחר זה” או „יחד”.",
    },
    {
      target: ".ear-training .ear-empty .primary-button, .ear-training .ear-playback",
      title: "השמעת השאלה",
      text: "לוחצים „התחל תרגול” והשאלה מתנגנת. „השמע שוב” משמיע אותה שוב, כמה פעמים שצריך.",
    },
    {
      target: ".ear-training .ear-choices",
      title: "בחירת תשובה",
      text: "לוחצים על מה שנשמע. התשובה הנכונה נצבעת, וגם טעות מסומנת.",
    },
    {
      target: ".ear-training .ear-verdict",
      title: "הסבר והמשך",
      text: "אחרי התשובה מופיע הסבר קצר של מה שנשמע, ו„השאלה הבאה” ממשיך.",
    },
    {
      title: "קיצורי מקלדת",
      text: "מקשי הספרות עונים לפי מספר התשובה, R משמיע שוב, ו־Enter עובר לשאלה הבאה (או מתחיל את הראשונה).",
    },
    {
      target: ".ear-training .ear-score",
      title: "הניקוד",
      text: "שאלות, דיוק, רצף ושיא — לכל תרגיל בנפרד, ונשמרים בדפדפן. „אפס ניקוד” מתחיל את התרגיל הנוכחי מאפס.",
    },
    {
      target: ".ear-training .save-work-button",
      title: "שמירת האימון",
      text: "אחרי שעונים על שאלה אחת לפחות, „שמור את האימון” שומר באזור האישי את התרגיל, הרמה והניקוד.",
    },
  ],

  rhythm: [
    {
      target: ".rhythm-tool .settings-panel",
      title: "רמה, תבנית וקצב",
      text: "בוחרים רמה ותבנית קצב, וקובעים קצב בין 40 ל־200 BPM. סימון „בלי לשמוע את התבנית” משאיר רק את הספירה, וזה קשה יותר.",
    },
    {
      target: ".rhythm-tool .rhythm-pattern",
      title: "התבנית",
      text: "כל משבצת היא שש־עשרית, והמשבצות המלאות הן ההקשות. בזמן הסיבוב הפעמה הנוכחית מודגשת.",
    },
    {
      target: ".rhythm-tool .rhythm-actions",
      title: "התחלת סיבוב",
      text: "„התחל” משמיע ספירה של תיבה אחת, ואז שתי תיבות שבהן מקישים את התבנית. „עצור” מפסיק באמצע.",
    },
    {
      target: ".rhythm-tool .rhythm-pad",
      title: "מקישים בקצב",
      text: "מקישים על הכרית, או ברווח, ב־Enter או בכל אות במקלדת. אחרי כל הקשה כתוב „מושלם”, „טוב”, „מוקדם” או „מאוחר” ובכמה אלפיות.",
    },
    {
      target: ".rhythm-tool .rhythm-score",
      title: "התוצאה",
      text: "בסוף הסיבוב מופיעים אחוז הדיוק, ההקשות המושלמות וההחטאות, האם יש נטייה למהר או לגרור, השיא וגרף של הסיבובים האחרונים.",
    },
    {
      target: ".rhythm-tool .save-work-button",
      title: "שמירת התוצאה",
      text: "אחרי סיבוב, „שמור את התוצאה” שומר אותה באזור האישי, ו„עוד סיבוב” מנסה שוב.",
    },
  ],

  changes: [
    {
      target: ".changes-tool .changes-setup .chip-row",
      title: "זוגות מומלצים",
      text: "לחיצה על זוג בוחרת שני אקורדים שכדאי לתרגל את המעבר ביניהם.",
    },
    {
      target: ".changes-tool .changes-pickers",
      title: "אקורדים ומשך",
      text: "או בוחרים אקורד ראשון ושני מהרשימות, את משך הסבב (30 שנ׳, דקה או 2 דק׳), ואם לשמוע את האקורד בכל מעבר.",
    },
    {
      target: ".changes-tool .changes-diagrams",
      title: "האצבוע",
      text: "הדיאגרמות מראות איך לתפוס את שני האקורדים, ולחיצה על דיאגרמה משמיעה אותו. בזמן הסבב מודגש האקורד שעוברים אליו.",
    },
    {
      target: ".changes-tool .changes-actions",
      title: "התחלה",
      text: "„התחלה” (או רווח) פותחת בספירה לאחור של שלוש שניות, ואז השעון רץ.",
    },
    {
      target: ".changes-tool .changes-tap",
      title: "סופרים מעברים",
      text: "בכל פעם שהיד נוחתת נקי על האקורד השני לוחצים „החלפתי”, או רווח או Enter, ומחליפים בחזרה.",
    },
    {
      target: ".changes-tool .changes-board",
      title: "התוצאה והשיא",
      text: "בסוף הסבב מופיע מספר המעברים. השיא לכל זוג נשמר במכשיר, ושיא חדש מסומן.",
    },
    {
      target: ".changes-tool .changes-history",
      title: "ההתקדמות",
      text: "אחרי סבב ראשון מופיע כאן גרף של הסבבים האחרונים בזוג, במעברים לדקה.",
    },
  ],

  theory: [
    {
      target: ".theory-tool .circle-card",
      title: "מעגל הקווינטות",
      text: "לחיצה על הטבעת החיצונית בוחרת סולם מז׳ור, ועל הפנימית מינור. במרכז מופיעים הטוניקה וסימני ההיתק, והשכנים במעגל מודגשים.",
    },
    {
      target: ".theory-tool .root-picker",
      title: "טוניקה",
      text: "אפשר גם לבחור טוניקה ישירות מהרשימה.",
    },
    {
      target: '.theory-tool [data-tour="theory-scale"]',
      title: "סולם או מודוס",
      text: "בוחרים סולם או מודוס — דורי, לידי, פנטטוני, בלוז ועוד — ומתחת מופיעה מילה על האופי שלו.",
    },
    {
      target: ".theory-tool .theory-actions",
      title: "השמעת הסולם",
      text: "„השמעת הסולם” מנגן אותו למעלה ולמטה, והתווים נדלקים על הפסנתר. לידו בוחרים את הצליל.",
    },
    {
      target: ".theory-tool .theory-facts",
      title: "עובדות על הסולם",
      text: "סימני ההיתק, הסולם המקביל ומבנה הסולם בטונים.",
    },
    {
      target: ".theory-tool .theory-notes",
      title: "תווי הסולם",
      text: "התווים של הסולם עם הדרגה של כל אחד. לחיצה על תו משמיעה אותו.",
    },
    {
      target: '.theory-tool [data-tour="theory-view"]',
      title: "פסנתר או גיטרה",
      text: "עוברים בין פסנתר לצוואר גיטרה. תווי הסולם מסומנים, הטוניקה בצבע מלא, ולחיצה על תו משמיעה אותו.",
    },
    {
      target: ".theory-tool .chord-cards",
      title: "האקורדים של הסולם",
      text: "אקורד על כל דרגה, עם הספרה הרומית והתווים שלו. בוחרים „משולשים” או „ספטאקורדים”, ולחיצה על אקורד משמיעה אותו.",
    },
    {
      target: ".theory-tool .progressions",
      title: "מהלכים מוכרים",
      text: "מהלכי אקורדים מפורסמים, כתובים בסולם שנבחר. לחיצה מנגנת את המהלך, ולחיצה נוספת עוצרת.",
    },
  ],
};
