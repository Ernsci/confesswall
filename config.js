module.exports = {
  maxWords: 1000,
  rateLimitMs: 30 * 1000,
  blockedMessage: "Your confession contains words we can't deliver. Please rewrite it with kindness.",

  badWords: {
    english: [
      "fuck", "fucked", "fucking", "fucker", "fuckers", "fuckboy", "fuckboys",
      "wtf", "stfu", "gtfo", "kys",
      "shit", "shitty", "bullshit",
      "bitch", "bitches", "bitchy", "son of a bitch",
      "bastard", "bastards", "asshole", "assholes", "arsehole", "arseholes",
      "dickhead", "dickheads", "cunt", "cunts", "douchebag", "douchebags",
      "twat", "twats", "bollocks", "bugger", "buggers",
      "wanker", "wankers", "wanking", "wanked",
      "slut", "sluts", "slutty", "skank", "skanks", "whore", "whores", "whoring",
      "dumbass", "cocksucker", "blowjob", "blowjobs", "handjob", "handjobs",
      "jackoff", "jerkoff", "jerking off", "dildo", "dildos",
      "porn", "porno", "hentai", "creampie",
      "boobs", "boobies", "titties", "titty",
      "jizz", "jizzed", "jizzing", "cumshot", "cumshots", "sexting",
      "molest", "molests", "molester", "molesters", "molested",
      "nigger", "niggers", "nigga", "niggas",
      "faggot", "faggots", "dyke", "dykes", "tranny", "trannies",
      "chink", "chinks", "gook", "gooks", "wetback", "wetbacks",
      "retard", "retards", "retarded",
      "damn", "dammit"
    ],

    tagalog: [
      "putang", "putang ina", "puta", "putangina", "tangina", "tang ina", "kingina",
      "punyeta", "tanga", "gago", "gaga", "tarantado", "inutil", "ungas", "ulol",
      "buwisit", "bwisit", "lintik", "shunga", "amputa",
      "sira ulo", "siraulo", "walang hiya", "walanghiya", "hayop ka",
      "ulupong", "haliparot", "malandi", "manyak", "libog", "bastos",
      "kantot", "kantutan", "kantutin", "kinantot", "jakol", "jabol", "chupa",
      "tamod", "bayag", "etits", "titi", "utoy",
      "puke", "puked", "puking", "pekpek", "puki", "burat"
    ],

    bisaya: [
      "yawa", "boang", "buang", "bugok", "atay", "bilat", "puday",
      "otin", "iyot", "iyutan", "bayot"
    ]
  },

  exactOnly: [
    "raped", "raping", "rapist", "cumming", "nudes", "horny", "prick", "bilat", "secret"
  ]
};
