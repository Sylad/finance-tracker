---
title: "Crédits : un mois sans prélèvement se voit sur la courbe « Réel »"
date: 2026-11-19
created: 2026-11-19T09:30+01:00
lots: [L178]
captures:
  - { file: captures/2026-11-19-amortissement-trou-courbe.png, alt: "Graphique d'amortissement du crédit CETELEM : la courbe verte Réel (estimé) s'interrompt en juillet 2026 entre deux points, puis reprend jusqu'au dernier prélèvement d'octobre 2026 ; la phrase dessous cite le mois interrompu." }
  - { file: captures/2026-11-19-amortissement-infobulle-mois-manquant.png, alt: "Infobulle de juillet 2026 : Prévu 7 379,00 €, et en orange « Réel (estimé) : aucun prélèvement trouvé ce mois-ci »." }
  - { file: captures/2026-11-19-amortissement-prelevement-hors-echeance-390.png, alt: "Sur téléphone, infobulle d'octobre 2026, mois sans échéance au tableau : Prévu 6 960,00 € (pas d'échéance ce mois), Réel (estimé) 6 958,00 €." }
---
Dans le tableau d'amortissement d'un crédit, si un mois n'a aucun prélèvement retrouvé dans tes relevés alors que les mois d'avant et d'après en ont un, la courbe verte « Réel (estimé) » s'interrompt sur ce mois au lieu de le traverser comme si le capital avait baissé normalement. Au survol, l'infobulle de ce mois le dit : « aucun prélèvement trouvé ce mois-ci ». La phrase sous le graphique cite aussi les mois interrompus.

Quand le dernier prélèvement tombe un mois où le tableau ne prévoit pas d'échéance (une mensualité prélevée en retard, par exemple), il a maintenant son propre point sur la courbe, et la phrase cite bien ce mois-là. L'infobulle précise alors « pas d'échéance ce mois ».
