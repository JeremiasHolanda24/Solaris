export interface LoreEntry {
  id: string;
  category: 'mission' | 'sentinels';
  title: string;
  classification: string;
  summary: string;
  imageSrc: string;
}

export const LORE_ENTRIES: LoreEntry[] = [
  {
    id: 'solaris-mission',
    category: 'mission',
    title: 'Sonda Solaris',
    classification: 'Nave de Reconhecimento · Observatório Meridiano',
    summary:
      'Construída com casco de marfim cerâmico e aros de latão calibrado, a Solaris foi enviada ao cinturão externo para reativar os meridianos do Grande Astrolábio. Ao coletar centelhas de energia solar, seu núcleo entra em Sobrecarga e abre passagem pelas defesas orbitais.',
    imageSrc: '/src/assets/images/solaris_player_ship_1795180787643.jpg',
  },
  {
    id: 'astrolabe-belt',
    category: 'mission',
    title: 'O Grande Astrolábio',
    classification: 'Relíquia Orbital · Setor 04',
    summary:
      'Os anéis dourados que giram sob a arena são restos de um antigo instrumento astronômico erguido para mapear eclipses e correntes solares. Sem manutenção há séculos, seus autômatos sentinelas passaram a tratar qualquer nave tripulada como anomalia.',
    imageSrc: '/src/assets/images/solaris_title_backdrop_1795179612479.jpg',
  },
  {
    id: 'sentinel-scout',
    category: 'sentinels',
    title: 'Vigia',
    classification: 'Interceptador Leve · Casco de Bronze',
    summary:
      'Unidade de patrulha rápida desenhada para cercar invasores em curvas fechadas. Frágil isoladamente, torna-se perigosa quando coordena ataques em enxame pelos flancos.',
    imageSrc: '/src/assets/images/solaris_enemy_scout_1795181299986.jpg',
  },
  {
    id: 'sentinel-striker',
    category: 'sentinels',
    title: 'Lança',
    classification: 'Caça de Investida · Liga Coral',
    summary:
      'Interceptador de lâminas duplas que suspende o voo para calibrar um feixe de mira antes de disparar em linha reta. O melhor contra-ataque é usar o Impulso no instante em que o feixe trava.',
    imageSrc: '/src/assets/images/solaris_enemy_striker_1795181300757.jpg',
  },
  {
    id: 'sentinel-bastion',
    category: 'sentinels',
    title: 'Bastião',
    classification: 'Canhoneira Pesada · Placas de Latão',
    summary:
      'Guardião blindado de longo alcance que orbita o alvo enquanto carrega seu reator central. Libera rajadas em leque que obrigam a Solaris a mudar constantemente de trajetória.',
    imageSrc: '/src/assets/images/solaris_enemy_bastion_1795181300327.jpg',
  },
  {
    id: 'sentinel-splitter',
    category: 'sentinels',
    title: 'Núcleo',
    classification: 'Drone Articulado · Conduto Turquesa',
    summary:
      'Formado por dois cascos crescentes acoplados a um núcleo de engrenagens celestes. Quando sua estrutura colapsa, as metades se separam em dois batedores velozes.',
    imageSrc: '/src/assets/images/solaris_enemy_splitter_1795181300379.jpg',
  },
];
