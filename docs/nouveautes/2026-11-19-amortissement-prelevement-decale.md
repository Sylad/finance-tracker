---
title: "Crédits : chaque prélèvement compte une fois, même si sa date glisse d'un mois"
date: 2026-11-19
created: 2026-11-19T13:30+01:00
lots: [L180]
captures:
  - { file: captures/2026-11-19-amortissement-echeance-decalee.png, alt: "Graphique d'amortissement du crédit CETELEM, infobulle d'août 2026 : Prévu 7 170,00 € et « Échéance prélevée en septembre 2026 », sans valeur Réel ce mois-là ; la phrase dessous dit « Échéance d'août 2026 prélevée en septembre 2026 » et « 1 prélèvement sans échéance correspondante, non compté dans le capital »." }
  - { file: captures/2026-11-19-amortissement-prelevement-compte-390.png, alt: "Sur téléphone, infobulle de septembre 2026 : Prévu 6 960,00 €, Réel (estimé) 6 960,00 € et « Prélèvement compté pour l'échéance d'août 2026 »." }
---
Les prélèvements d'un crédit ne tombent pas toujours le même jour : une mensualité prévue fin de mois peut partir le 1er ou le 2 du mois suivant, ou quelques jours en avance. Le tableau d'amortissement en tient compte : un prélèvement dont la date a glissé dans le mois voisin est compté pour l'échéance de ce mois-là, à condition que ce mois n'ait aucun autre prélèvement. Le mois n'est donc plus annoncé « sans prélèvement », et la courbe « Réel (estimé) » ne prend plus une échéance de retard.

Au survol, l'infobulle le dit des deux côtés : « Échéance prélevée en septembre 2026 » sur le mois de l'échéance, « Prélèvement compté pour l'échéance d'août 2026 » sur le mois du prélèvement. La phrase sous le graphique le rappelle aussi. Le mois de l'échéance n'a pas de valeur « Réel » : rien n'y a été prélevé, et la courbe ne montre une valeur que pour un mois où un prélèvement a eu lieu.

Un prélèvement en trop (prélevé deux fois, régularisation) n'est jamais compté deux fois ni ne décale les mois suivants : il reste à part, et la phrase sous le graphique le signale (« 1 prélèvement sans échéance correspondante, non compté dans le capital »). « Dernier prélèvement connu » donne toujours le mois du dernier prélèvement réel, même quand il paie une échéance en avance.
