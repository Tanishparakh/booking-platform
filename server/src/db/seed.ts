import { migrate } from './migrate';
import { pool, one, query } from './pool';
import { hashPassword } from '../utils/security';
import { addDays, eachDay, todayString } from '../utils/dates';

/** Demo data with rich portfolios, avatars, bookings, reviews, and analytics. */
export async function seed() {
  await migrate();
  const hasReviews = await one('SELECT 1 FROM reviews LIMIT 1');
  if (hasReviews) {
    console.log('Comprehensive seed data already present.');
    return;
  }

  console.log('Populating comprehensive demo data for FrameBook...');

  // Clean existing tables in reverse dependency order
  await query('DELETE FROM audit_log');
  await query('DELETE FROM content_reports');
  await query('DELETE FROM notifications');
  await query('DELETE FROM messages');
  await query('DELETE FROM disputes');
  await query('DELETE FROM reviews');
  await query('DELETE FROM booking_events');
  await query('DELETE FROM deliverables');
  await query('DELETE FROM payouts');
  await query('DELETE FROM payments');
  await query('DELETE FROM bookings');
  await query('DELETE FROM verifications');
  await query('DELETE FROM availability');
  await query('DELETE FROM packages');
  await query('DELETE FROM portfolio_items');
  await query('DELETE FROM profiles');
  await query('DELETE FROM payout_accounts');
  await query('DELETE FROM clients');
  await query('DELETE FROM professionals');
  await query('DELETE FROM users');

  const mkUser = async (email: string, name: string, role: string, pw: string, phone?: string) =>
    (
      await one(
        'INSERT INTO users (email, password_hash, full_name, phone, role, email_verified) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id',
        [email.toLowerCase(), await hashPassword(pw), name, phone || null, role]
      )
    ).id as number;

  // 1. Admin & Staff
  const adminId = await mkUser('admin@example.com', 'Alex Admin', 'ADMIN', 'Admin@123', '+91 99000 11223');
  await mkUser('support@example.com', 'Sam Support', 'SUPPORT', 'Support@123', '+91 99000 44556');

  // 2. Clients
  const clientChris = await mkUser('client@example.com', 'Chris Client', 'CLIENT', 'Client@123', '+91 98201 12345');
  await query('INSERT INTO clients (user_id, preferences, address) VALUES ($1,$2,$3)', [
    clientChris,
    'Prefers candid photography, natural lighting, warm pastel tones',
    'Bandra West, Mumbai',
  ]);

  const clientDana = await mkUser('client2@example.com', 'Dana Client', 'CLIENT', 'Client@123', '+91 98112 54321');
  await query('INSERT INTO clients (user_id, preferences, address) VALUES ($1,$2,$3)', [
    clientDana,
    'Corporate 4K highlight reels, keynote speakers, quick turnaround',
    'Indiranagar, Bengaluru',
  ]);

  const clientPriya = await mkUser('priya@example.com', 'Priya Sharma', 'CLIENT', 'Client@123', '+91 98765 43210');
  await query('INSERT INTO clients (user_id, preferences, address) VALUES ($1,$2,$3)', [clientPriya, 'Pre-wedding and wedding shoots', 'Andheri, Mumbai']);

  const clientRahul = await mkUser('rahul@example.com', 'Rahul Verma', 'CLIENT', 'Client@123', '+91 97110 99887');
  await query('INSERT INTO clients (user_id, preferences, address) VALUES ($1,$2,$3)', [clientRahul, 'Event coverage and conference recaps', 'Connaught Place, Delhi']);

  const clientKavita = await mkUser('kavita@example.com', 'Kavita Rao', 'CLIENT', 'Client@123', '+91 99887 66554');
  await query('INSERT INTO clients (user_id, preferences, address) VALUES ($1,$2,$3)', [clientKavita, 'Studio product catalogs and fashion lookbooks', 'Juhu, Mumbai']);

  const clientAmit = await mkUser('amit@example.com', 'Amit Patel', 'CLIENT', 'Client@123', '+91 98334 11223');
  await query('INSERT INTO clients (user_id, preferences, address) VALUES ($1,$2,$3)', [clientAmit, 'Family celebrations and portraits', 'Koramangala, Bengaluru']);

  // 3. Professionals (Photographers & Videographers)
  interface ProDef {
    email: string;
    name: string;
    type: 'PHOTOGRAPHER' | 'VIDEOGRAPHER';
    city: string;
    yrs: number;
    spec: string;
    headline: string;
    bio: string;
    equipment: string;
    hourly: number;
    avatar: string;
    bank: { holder: string; name: string; last4: string };
    packages: [string, string, number, number][];
    portfolio: [string, string, string][];
  }

  const proDefs: ProDef[] = [
    {
      email: 'maya@example.com',
      name: 'Maya Rao',
      type: 'PHOTOGRAPHER',
      city: 'Mumbai',
      yrs: 6,
      spec: 'Weddings & candid portraits',
      headline: 'Candid wedding & family photographer',
      bio: 'Award-winning wedding photographer capturing raw, heartfelt moments across India. Over 100+ happy couples photographed with natural color science, emotional storytelling, and warm golden tones.',
      equipment: 'Sony A7 IV, 24-70mm f/2.8 GM II, 85mm f/1.4 GM, Godox V1 Strobes',
      hourly: 5000,
      avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop&q=80',
      bank: { holder: 'Maya Rao', name: 'HDFC Bank', last4: '4092' },
      packages: [
        ['Wedding Day Coverage (8h)', 'Comprehensive full-day candid and traditional coverage with 2 photographers. 500+ edited high-res digital files delivered.', 40000, 8],
        ['Engagement & Pre-Wedding Shoot (3h)', 'Sunset or scenic location pre-wedding session with outfit changes. 50 curated high-resolution edited images.', 12000, 3],
        ['Family & Maternity Portrait (2h)', 'Intimate outdoor or in-home documentary family portrait session.', 8000, 2],
      ],
      portfolio: [
        ['Royal Mandap Ceremony', 'Traditional Vedic wedding ceremony capturing the sacred vows and joy.', 'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&auto=format&fit=crop&q=80'],
        ["Bride's Golden Hour Portrait", 'Natural light bridal portrait featuring hand-embroidered lehenga details.', 'https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=800&auto=format&fit=crop&q=80'],
        ['Sunset Pheras & Celebration', 'Candid moments during the evening pheras under twinkling fairy lights.', 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=800&auto=format&fit=crop&q=80'],
        ['Sangeet Dance & Joy', 'High-energy dance floor celebrations with friends and family.', 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=800&auto=format&fit=crop&q=80'],
        ['Intimate Rings Exchange', 'Macro focus on the handcrafted wedding rings and mehndi details.', 'https://images.unsplash.com/photo-1606800052052-a08af7148866?w=800&auto=format&fit=crop&q=80'],
        ['Grand Floral Entrance Decor', 'Grand floral pathway designed with marigolds and white roses.', 'https://images.unsplash.com/photo-1532712938310-34cb3982ef74?w=800&auto=format&fit=crop&q=80'],
      ],
    },
    {
      email: 'arjun@example.com',
      name: 'Arjun Mehta',
      type: 'VIDEOGRAPHER',
      city: 'Delhi',
      yrs: 8,
      spec: 'Corporate events & cinematic films',
      headline: 'Cinematic commercial & event videographer',
      bio: 'Specializing in cinematic 4K video reels, corporate summits, and commercial brand documentaries with fast 48-hour turnarounds. Equipped with cinema cameras and licensed aerial drones.',
      equipment: 'Sony FX3 Cinema Line, DJI Ronin RS3 Pro, DJI Mavic 3 Pro Cine Drone, Sennheiser wireless audio',
      hourly: 6500,
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
      bank: { holder: 'Arjun Mehta', name: 'ICICI Bank', last4: '8812' },
      packages: [
        ['Corporate Event Highlights Reel (6h)', 'Multi-camera 4K event coverage, audio mastering, dynamic edit with licensed music soundtrack.', 55000, 6],
        ['Executive Studio Interview (3h)', 'Studio lighting setup, teleprompter, lavalier mics, and executive color grade.', 20000, 3],
        ['Commercial Brand Ad Film (8h)', 'Concept to final cut commercial video production for product launches and social campaigns.', 85000, 8],
      ],
      portfolio: [
        ['Tech Summit Keynote Coverage', 'Multi-camera 4K stage coverage with crisp wireless audio recording.', 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&auto=format&fit=crop&q=80'],
        ['Aerial Drone Festival Reel', 'Breathtaking 4K golden-hour drone sweep over festival grounds.', 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&auto=format&fit=crop&q=80'],
        ['Founder Studio Interview', 'Intimate studio three-point lighting profile with cinematic shallow depth of field.', 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&auto=format&fit=crop&q=80'],
        ['Annual Leadership Gala Night', 'Cinematic red carpet and keynote highlight reel for multinational brands.', 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&auto=format&fit=crop&q=80'],
      ],
    },
    {
      email: 'isha@example.com',
      name: 'Isha Kapoor',
      type: 'PHOTOGRAPHER',
      city: 'Mumbai',
      yrs: 3,
      spec: 'E-commerce products & fashion',
      headline: 'Product & editorial fashion photographer',
      bio: 'Creating scroll-stopping commercial imagery for luxury skincare, cosmetics, jewelry, and apparel brands. Precision lighting and color-accurate workflows for high-converting e-commerce.',
      equipment: 'Fujifilm GFX 100S Medium Format, Broncolor Studio Strobes, Tether Tools Pro',
      hourly: 4500,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
      bank: { holder: 'Isha Kapoor', name: 'Axis Bank', last4: '5521' },
      packages: [
        ['E-Commerce Product Catalog (4h)', 'Up to 20 product SKUs photographed on pure white & styled creative background with commercial retouches.', 15000, 4],
        ['Editorial Fashion Lookbook (6h)', 'Model fashion shoot with wardrobe styling assistance, creative lighting, and high-fashion retouches.', 32000, 6],
      ],
      portfolio: [
        ['Luxury Perfume Bottle Aesthetic', 'Minimalist reflections and water droplets on frosted glass.', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&auto=format&fit=crop&q=80'],
        ['Minimalist Leather Accessories', 'Earthy studio tones highlighting premium stitch textures.', 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&auto=format&fit=crop&q=80'],
        ['Editorial High Fashion Lookbook', 'Contemporary editorial lighting with directional beauty dish.', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&auto=format&fit=crop&q=80'],
        ['Chronograph Watch Macro Detail', 'High-precision macro focus on luxury mechanical timepiece dial.', 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=800&auto=format&fit=crop&q=80'],
      ],
    },
    {
      email: 'rohan@example.com',
      name: 'Rohan Das',
      type: 'VIDEOGRAPHER',
      city: 'Bengaluru',
      yrs: 5,
      spec: 'Music videos & indie films',
      headline: 'Music video & narrative filmmaker',
      bio: 'Crafting visually arresting music videos, indie shorts, and stylized promos with bold color palettes, practical neon lighting, and dynamic camera movement.',
      equipment: 'Blackmagic Pocket Cinema 6K Pro, DZOFilm Cine Zooms, Aputure Lighting Kit',
      hourly: 6000,
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
      bank: { holder: 'Rohan Das', name: 'Kotak Mahindra Bank', last4: '3341' },
      packages: [
        ['Full Music Video Production (10h)', 'Full-day narrative location shoot, art direction, specialized lighting, color grading and master delivery.', 70000, 10],
        ['Social Media Artist Teaser (4h)', 'Quick-cut performance promo optimized for vertical 9:16 and 16:9 formats.', 28000, 4],
      ],
      portfolio: [
        ['Neon Night Cinematic Frame', 'Moody anamorphic street lighting in rain-soaked downtown alley.', 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop&q=80'],
        ['Live Acoustic Stage Session', 'Warm tungsten haze during live concert performance.', 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&auto=format&fit=crop&q=80'],
        ['Analog Vinyl Recording Studio', 'Vintage aesthetic documentary inside soundproof recording booth.', 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=800&auto=format&fit=crop&q=80'],
        ['Indie Artist Narrative Scene', 'Slow-motion storytelling portrait with dramatic practical lighting.', 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80'],
      ],
    },
    {
      email: 'neha@example.com',
      name: 'Neha Iyer',
      type: 'PHOTOGRAPHER',
      city: 'Bengaluru',
      yrs: 10,
      spec: 'Portraits & celebrations',
      headline: 'Natural-light portrait & celebration photographer',
      bio: 'Specialist in warm family portraits, milestone birthdays, and joyful baby showers with an authentic documentary feel. 10 years of experience making people comfortable in front of the lens.',
      equipment: 'Canon EOS R6 Mark II, RF 50mm f/1.2L, RF 28-70mm f/2L, Profoto B10X',
      hourly: 4000,
      avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&auto=format&fit=crop&q=80',
      bank: { holder: 'Neha Iyer', name: 'State Bank of India', last4: '9920' },
      packages: [
        ['Studio Portrait Session (2h)', 'Relaxed headshot or family session with 25 retouched high-resolution images.', 8000, 2],
        ['Full Day Celebration Coverage (6h)', 'Candid coverage for birthday parties, anniversaries, or baby showers.', 25000, 6],
      ],
      portfolio: [
        ['Golden Hour Family Portrait', 'Spontaneous outdoor family moments bathed in warm evening sunlight.', 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=800&auto=format&fit=crop&q=80'],
        ['First Birthday Celebration', 'Joyful candid expressions, balloon decor, and cake smash smiles.', 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800&auto=format&fit=crop&q=80'],
        ['Creative Maternity Glow', 'Gentle studio portrait celebrating upcoming parenthood.', 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=800&auto=format&fit=crop&q=80'],
        ['University Graduation Candid', 'Proud graduate cap toss captured in crisp natural sunlight.', 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800&auto=format&fit=crop&q=80'],
      ],
    },
  ];

  const proIds: Record<string, number> = {};
  const packageIds: Record<string, number> = {};

  for (const p of proDefs) {
    const id = await mkUser(p.email, p.name, 'PROFESSIONAL', 'Pro@12345', '+91 98' + Math.floor(10000000 + Math.random() * 90000000));
    proIds[p.email] = id;

    await query(
      'INSERT INTO professionals (user_id, professional_type, operating_city, experience_years, equipment, specialization, verification_status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, p.type, p.city, p.yrs, p.equipment, p.spec, 'APPROVED']
    );

    await query(
      'INSERT INTO profiles (professional_id, headline, bio, location, hourly_rate, profile_image_key) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, p.headline, p.bio, p.city, p.hourly, p.avatar]
    );

    await query(
      'INSERT INTO payout_accounts (professional_id, account_holder, bank_name, account_last4) VALUES ($1,$2,$3,$4)',
      [id, p.bank.holder, p.bank.name, p.bank.last4]
    );

    for (const [name, desc, price, dur] of p.packages) {
      const pkg = await one(
        'INSERT INTO packages (professional_id, name, description, price, duration_hours) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [id, name, desc, price, dur]
      );
      packageIds[`${p.email}:${name}`] = pkg.id;
    }

    for (const [title, desc, url] of p.portfolio) {
      await query(
        'INSERT INTO portfolio_items (professional_id, title, description, media_key, media_type, content_type) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, title, desc, url, 'IMAGE', 'image/jpeg']
      );
    }

    // Availability for next 60 days
    for (const d of eachDay(addDays(todayString(), 1), addDays(todayString(), 60))) {
      await query("INSERT INTO availability (professional_id, slot_date, start_time, end_time) VALUES ($1,$2,'09:00','19:00')", [id, d]);
    }
  }

  // Pending verification professional (for admin queue)
  const pendingId = await mkUser('pending@example.com', 'Vikram Sethi', 'PROFESSIONAL', 'Pro@12345', '+91 91234 56789');
  await query("INSERT INTO professionals (user_id, professional_type, operating_city, experience_years, specialization, verification_status) VALUES ($1,'PHOTOGRAPHER','Pune',4,'Architecture & real estate','PENDING')", [pendingId]);
  await query("INSERT INTO profiles (professional_id, headline, bio, location, profile_image_key) VALUES ($1,$2,$3,$4,$5)", [
    pendingId,
    'Architectural and interior space photographer',
    'Specialist in luxury residential properties, hotels, and commercial spaces with wide tilt-shift lenses.',
    'Pune',
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&auto=format&fit=crop&q=80',
  ]);
  await query("INSERT INTO verifications (professional_id, document_type, document_key, content_type, status, remarks) VALUES ($1,$2,$3,$4,'PENDING',$5)", [
    pendingId,
    'Government Photo ID & Studio Certificate',
    'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800&auto=format&fit=crop&q=80',
    'image/jpeg',
    'Awaiting administrator identity check.',
  ]);

  // 4. Seed Live Bookings Across Real-World Lifecycle Stages

  // Helper for inserting complete bookings
  const createBooking = async (opts: {
    client: number;
    pro: number;
    pkgId: number;
    eventType: string;
    startDate: string;
    endDate: string;
    venue: string;
    notes?: string;
    total: number;
    commission: number;
    payout: number;
    status: string;
    deliveredAt?: string;
    completedAt?: string;
    createdAt?: string;
    paymentStatus?: string;
    cardBrand?: string;
    cardLast4?: string;
    payoutStatus?: string;
  }) => {
    const b = await one(
      `INSERT INTO bookings (client_id, professional_id, package_id, event_type, start_date, end_date, start_time, end_time,
                             venue, notes, total_amount, commission_percent, commission_amount, payout_amount, status,
                             delivered_at, completed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'10:00','18:00',$7,$8,$9,10,$10,$11,$12,$13,$14,COALESCE($15::timestamptz,now()),now())
       RETURNING id`,
      [
        opts.client,
        opts.pro,
        opts.pkgId,
        opts.eventType,
        opts.startDate,
        opts.endDate,
        opts.venue,
        opts.notes || null,
        opts.total,
        opts.commission,
        opts.payout,
        opts.status,
        opts.deliveredAt ? new Date(opts.deliveredAt).toISOString() : null,
        opts.completedAt ? new Date(opts.completedAt).toISOString() : null,
        opts.createdAt || null,
      ]
    );

    if (opts.paymentStatus) {
      await query(
        `INSERT INTO payments (booking_id, amount, card_brand, card_last4, status, gateway_txn_id, authorized_at, captured_at, released_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now(),$7,COALESCE($8::timestamptz,now()))`,
        [
          b.id,
          opts.total,
          opts.cardBrand || 'Visa',
          opts.cardLast4 || '4242',
          opts.paymentStatus,
          'txn_' + Math.random().toString(36).substring(2, 12),
          opts.paymentStatus === 'RELEASED' ? new Date().toISOString() : null,
          opts.createdAt || null,
        ]
      );
    }

    if (opts.payoutStatus) {
      await query(
        `INSERT INTO payouts (booking_id, professional_id, gross_amount, commission_amount, net_amount, status, gateway_ref, created_at, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,now()),$9)`,
        [
          b.id,
          opts.pro,
          opts.total,
          opts.commission,
          opts.payout,
          opts.payoutStatus,
          'payout_' + Math.random().toString(36).substring(2, 10),
          opts.createdAt || null,
          opts.payoutStatus === 'PAID' ? new Date().toISOString() : null,
        ]
      );
    }

    return b.id as number;
  };

  // BOOKING 1: COMPLETED (Chris Client -> Maya Rao)
  const b1Id = await createBooking({
    client: clientChris,
    pro: proIds['maya@example.com'],
    pkgId: packageIds['maya@example.com:Wedding Day Coverage (8h)'],
    eventType: 'Destination Wedding Ceremony & Reception',
    startDate: addDays(todayString(), -14),
    endDate: addDays(todayString(), -14),
    venue: 'Taj Lands End, Bandra, Mumbai',
    notes: 'Please arrive early for the bridal prep suite. Shot list sent by email.',
    total: 40000,
    commission: 4000,
    payout: 36000,
    status: 'COMPLETED',
    deliveredAt: addDays(todayString(), -10),
    completedAt: addDays(todayString(), -9),
    createdAt: addDays(todayString(), -18) + 'T10:00:00Z',
    paymentStatus: 'RELEASED',
    cardBrand: 'Visa',
    cardLast4: '4242',
    payoutStatus: 'PAID',
  });

  await query(
    `INSERT INTO deliverables (booking_id, file_name, content_type, file_size, storage_key, round, status)
     VALUES ($1,$2,$3,$4,$5,0,'AVAILABLE')`,
    [b1Id, 'MayaRao_Wedding_FullGallery_HighRes.zip', 'application/zip', 485000000, 'deliverables/maya-wedding-full-res.zip']
  );

  await query('INSERT INTO reviews (booking_id, client_id, professional_id, rating, comment) VALUES ($1,$2,$3,$4,$5)', [
    b1Id,
    clientChris,
    proIds['maya@example.com'],
    5,
    'Maya captured our wedding so beautifully! The candid emotions and lighting in every shot were beyond what we envisioned. She was punctual, calm, and made everyone feel completely natural. The final gallery of 650 photos was delivered ahead of schedule!',
  ]);

  await query(
    `INSERT INTO messages (booking_id, sender_id, receiver_id, content, sent_at) VALUES
     ($1,$2,$3,'Hi Maya! We are thrilled to book you for our wedding at Taj Lands End. We have shared the schedule.',now() - interval '17 days'),
     ($1,$3,$2,'Hi Chris! Thank you so much. The timeline looks perfect. My assistant and I will arrive with both camera bodies at 7:30 AM.',now() - interval '16 days'),
     ($1,$3,$2,'All edited high-resolution photographs are packaged into the ZIP deliverable above. Enjoy the memories!',now() - interval '10 days'),
     ($1,$2,$3,'We absolutely loved every single picture Maya! Thank you for preserving our memories so perfectly.',now() - interval '9 days')`,
    [b1Id, clientChris, proIds['maya@example.com']]
  );

  // BOOKING 2: DELIVERED (Chris Client -> Isha Kapoor) - Ready for live approval in video!
  const b2Id = await createBooking({
    client: clientChris,
    pro: proIds['isha@example.com'],
    pkgId: packageIds['isha@example.com:E-Commerce Product Catalog (4h)'],
    eventType: 'Organic Skincare Summer Catalog Launch',
    startDate: addDays(todayString(), -3),
    endDate: addDays(todayString(), -3),
    venue: 'Studio Lumen, Lower Parel, Mumbai',
    notes: '12 skincare jars and bottles. Clean white background and minimalist styled botanical props.',
    total: 15000,
    commission: 1500,
    payout: 13500,
    status: 'DELIVERED',
    deliveredAt: addDays(todayString(), -1),
    createdAt: addDays(todayString(), -7) + 'T11:00:00Z',
    paymentStatus: 'HELD',
    cardBrand: 'Mastercard',
    cardLast4: '5520',
    payoutStatus: 'PENDING',
  });

  await query(
    `INSERT INTO deliverables (booking_id, file_name, content_type, file_size, storage_key, round, status)
     VALUES ($1,$2,$3,$4,$5,0,'AVAILABLE')`,
    [b2Id, 'Cosmetics_Spring2026_Edited_Batch1.zip', 'application/zip', 128000000, 'deliverables/isha-catalog-batch1.zip']
  );

  await query(
    `INSERT INTO messages (booking_id, sender_id, receiver_id, content, sent_at) VALUES
     ($1,$2,$3,'Hi Isha, products were dispatched to your studio via courier today.',now() - interval '6 days'),
     ($1,$3,$2,'Received all 12 units safely! Commencing the studio lighting setup and test shots.',now() - interval '4 days'),
     ($1,$3,$2,'Batch 1 of edited commercial images is now uploaded above! Please review and click Approve to release payout.',now() - interval '1 day')`,
    [b2Id, clientChris, proIds['isha@example.com']]
  );

  // BOOKING 3: CONFIRMED (Dana Client -> Arjun Mehta) - Active / Upcoming Job
  const b3Id = await createBooking({
    client: clientDana,
    pro: proIds['arjun@example.com'],
    pkgId: packageIds['arjun@example.com:Corporate Event Highlights Reel (6h)'],
    eventType: 'Fintech Leadership Summit 2026',
    startDate: addDays(todayString(), 4),
    endDate: addDays(todayString(), 4),
    venue: 'Hyatt Regency, Aerocity, New Delhi',
    notes: 'Keynote starts at 10 AM. We need 1 fast 60-second teaser reel for LinkedIn within 24 hours.',
    total: 55000,
    commission: 5500,
    payout: 49500,
    status: 'CONFIRMED',
    createdAt: addDays(todayString(), -2) + 'T14:30:00Z',
    paymentStatus: 'HELD',
    cardBrand: 'Amex',
    cardLast4: '1005',
    payoutStatus: 'PENDING',
  });

  await query(
    `INSERT INTO messages (booking_id, sender_id, receiver_id, content, sent_at) VALUES
     ($1,$2,$3,'Hi Arjun, excited to have you film our summit. The speaker lineup and run-of-show is finalized.',now() - interval '2 days'),
     ($1,$3,$2,'Hi Dana! Received. We will bring two FX3 cinema setups and record wireless lavalier feeds directly.',now() - interval '1 day')`,
    [b3Id, clientDana, proIds['arjun@example.com']]
  );

  // BOOKING 4: PENDING (Chris Client -> Maya Rao) - Ready for Maya to click Accept in video!
  const b4Id = await createBooking({
    client: clientChris,
    pro: proIds['maya@example.com'],
    pkgId: packageIds['maya@example.com:Engagement & Pre-Wedding Shoot (3h)'],
    eventType: 'Sunrise Coastal Pre-Wedding Shoot',
    startDate: addDays(todayString(), 12),
    endDate: addDays(todayString(), 12),
    venue: 'Marine Drive & Colaba Gateway, Mumbai',
    notes: 'We would love to shoot at 6:30 AM sunrise to catch the golden light without crowd.',
    total: 12000,
    commission: 1200,
    payout: 10800,
    status: 'PENDING',
    createdAt: addDays(todayString(), -1) + 'T09:15:00Z',
    paymentStatus: 'AUTHORIZED',
    cardBrand: 'Visa',
    cardLast4: '4242',
  });

  await query(
    `INSERT INTO messages (booking_id, sender_id, receiver_id, content, sent_at) VALUES
     ($1,$2,$3,'Hi Maya, we fell in love with your candid portfolio! Would you be available for a sunrise session at Marine Drive on this date?',now() - interval '18 hours')`,
    [b4Id, clientChris, proIds['maya@example.com']]
  );

  // BOOKING 5: DISPUTED (Dana Client -> Rohan Das) - Ready for Staff/Admin dispute demo!
  const b5Id = await createBooking({
    client: clientDana,
    pro: proIds['rohan@example.com'],
    pkgId: packageIds['rohan@example.com:Social Media Artist Teaser (4h)'],
    eventType: 'Indie Band Single Teaser Promo',
    startDate: addDays(todayString(), -10),
    endDate: addDays(todayString(), -10),
    venue: 'Sound Space Studios, Indiranagar, Bengaluru',
    notes: 'Moody neon aesthetic video.',
    total: 28000,
    commission: 2800,
    payout: 25200,
    status: 'DISPUTED',
    deliveredAt: addDays(todayString(), -6),
    createdAt: addDays(todayString(), -15) + 'T12:00:00Z',
    paymentStatus: 'HELD',
    cardBrand: 'Visa',
    cardLast4: '4242',
    payoutStatus: 'PENDING',
  });

  await query(
    `INSERT INTO disputes (booking_id, raised_by, reason, description, status)
     VALUES ($1,$2,$3,$4,'OPEN')`,
    [
      b5Id,
      clientDana,
      'Deliverable delay & distorted audio mix',
      'The video deliverable was delivered 4 days past the agreed deadline, and the audio soundtrack has audible clipping on mobile speakers. Requesting audio re-mastering or partial refund.',
    ]
  );

  // 5. Additional Historical Completed Bookings to Populate the Admin Monthly Revenue Chart
  // July, August, September, October volumes for gorgeous growth analytics
  const histPros = [proIds['maya@example.com'], proIds['arjun@example.com'], proIds['rohan@example.com'], proIds['neha@example.com'], proIds['isha@example.com']];
  const histClients = [clientPriya, clientRahul, clientKavita, clientAmit, clientDana];

  const historicalMonths = [
    { name: 'July', offsetDays: -90, bookings: [[40000, 'Wedding Reception'], [55000, 'Tech Conference'], [25000, 'Corporate Dinner']] },
    { name: 'August', offsetDays: -60, bookings: [[70000, 'Music Video Shoot'], [40000, 'Wedding Day'], [32000, 'Fashion Lookbook'], [38000, 'Brand Promo']] },
    { name: 'September', offsetDays: -30, bookings: [[55000, 'Product Launch Gala'], [70000, 'Commercial Ad Film'], [40000, 'Palace Wedding'], [25000, 'Anniversary Celebration'], [50000, 'Startup Summit']] },
  ];

  for (const m of historicalMonths) {
    for (let i = 0; i < m.bookings.length; i++) {
      const [amtRaw, title] = m.bookings[i];
      const amt = Number(amtRaw);
      const pro = histPros[i % histPros.length];
      const client = histClients[i % histClients.length];
      const comm = Math.round(amt * 0.1);
      const net = amt - comm;
      const bDate = addDays(todayString(), m.offsetDays + i * 4);

      const hb = await one(
        `INSERT INTO bookings (client_id, professional_id, package_id, event_type, start_date, end_date, start_time, end_time,
                               venue, total_amount, commission_percent, commission_amount, payout_amount, status,
                               delivered_at, completed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5,'09:00','17:00','Convention Center & Studio',$6,10,$7,$8,'COMPLETED',
                 $9::timestamptz,$9::timestamptz,$10::timestamptz,now()) RETURNING id`,
        [client, pro, packageIds['maya@example.com:Wedding Day Coverage (8h)'], title, bDate, amt, comm, net, bDate + 'T18:00:00Z', bDate + 'T09:00:00Z']
      );

      await query(
        `INSERT INTO payments (booking_id, amount, card_brand, card_last4, status, gateway_txn_id, authorized_at, captured_at, released_at, created_at)
         VALUES ($1,$2,'Visa','4242','RELEASED',$3,$4::timestamptz,$4::timestamptz,$4::timestamptz,$4::timestamptz)`,
        [hb.id, amt, 'txn_hist_' + Math.random().toString(36).substring(2, 8), bDate + 'T10:00:00Z']
      );

      await query(
        `INSERT INTO payouts (booking_id, professional_id, gross_amount, commission_amount, net_amount, status, gateway_ref, created_at, paid_at)
         VALUES ($1,$2,$3,$4,$5,'PAID',$6,$7::timestamptz,$7::timestamptz)`,
        [hb.id, pro, amt, comm, net, 'payout_hist_' + Math.random().toString(36).substring(2, 8), bDate + 'T18:30:00Z']
      );
    }
  }

  // 6. Rich Client Reviews for All Professionals (So Search Shows Stars and High Ratings)
  const reviewDefs = [
    // Maya Rao
    [b1Id, clientChris, proIds['maya@example.com'], 5, 'Maya captured our wedding so beautifully! The candid emotions and lighting in every shot were beyond what we envisioned. She was punctual, calm, and made everyone feel completely natural.'],
    // Dana for Maya
    [null, clientDana, proIds['maya@example.com'], 5, 'Exceptional work on our family anniversary shoot. The photos were delivered ahead of schedule and the color palette was breathtaking.'],
    // Priya for Maya
    [null, clientPriya, proIds['maya@example.com'], 5, 'Hired Maya for our pre-wedding photoshoot in Mumbai. Every single picture looks like it belongs in a high-fashion magazine! Highly recommend her candid style.'],

    // Arjun Mehta
    [null, clientChris, proIds['arjun@example.com'], 5, "Arjun's video recap for our product launch was phenomenal. Drone footage and sound editing were Hollywood-grade."],
    [null, clientRahul, proIds['arjun@example.com'], 5, 'Very professional team. Captured our full 2-day conference seamlessly with multi-camera setups.'],

    // Isha Kapoor
    [null, clientDana, proIds['isha@example.com'], 5, "Isha's product photos increased our e-commerce conversion by 30%. Clean lighting and great attention to detail."],
    [null, clientKavita, proIds['isha@example.com'], 5, 'Flawless studio lookbook shoot for our summer apparel line. Very responsive and talented.'],

    // Rohan Das
    [null, clientChris, proIds['rohan@example.com'], 5, 'Rohan is a genius with neon and low-light cinematography. Our music video has gained 50k views already!'],
    [null, clientAmit, proIds['rohan@example.com'], 4, 'Great creative director. Understood the brief and brought fresh narrative ideas.'],

    // Neha Iyer
    [null, clientDana, proIds['neha@example.com'], 5, 'Neha has an incredible way with kids and captured natural smiles effortlessly during our baby shower.'],
    [null, clientAmit, proIds['neha@example.com'], 5, 'Wonderful family portrait experience. Very warm, patient, and accommodating.'],
  ];

  for (const [existingBId, client, pro, rating, comment] of reviewDefs) {
    if (existingBId) continue; // Already added for b1Id
    const pastDate = addDays(todayString(), -25);
    const dummyB = await one(
      `INSERT INTO bookings (client_id, professional_id, package_id, event_type, start_date, end_date, start_time, end_time,
                             venue, total_amount, commission_percent, commission_amount, payout_amount, status, completed_at)
       VALUES ($1,$2,$3,'Portrait / Event Session',$4,$4,'10:00','14:00',
               'Studio & Outdoor',12000,10,1200,10800,'COMPLETED',now() - interval '20 days') RETURNING id`,
      [client, pro, packageIds['maya@example.com:Engagement & Pre-Wedding Shoot (3h)'], pastDate]
    );
    await query('INSERT INTO reviews (booking_id, client_id, professional_id, rating, comment) VALUES ($1,$2,$3,$4,$5)', [
      dummyB.id,
      client,
      pro,
      rating,
      comment,
    ]);
  }

  // 7. Content Reports for Staff Moderation Queue
  await query(
    `INSERT INTO content_reports (reporter_id, target_type, target_id, reason, status)
     VALUES ($1,'PORTFOLIO_ITEM',1,$2,'OPEN')`,
    [clientDana, 'Copyright check inquiry for editorial usage confirmation.']
  );

  // 8. Notifications
  await query(
    `INSERT INTO notifications (user_id, type, message, booking_id, is_read) VALUES
     ($1,'BOOKING_COMPLETED','Your booking #1 with Maya Rao has been marked completed. Thank you!',$4,TRUE),
     ($1,'DELIVERABLE_UPLOADED','New high-resolution deliverables are available for booking #2.',$5,FALSE),
     ($2,'NEW_BOOKING_REQUEST','You have received a new booking request #4 from Chris Client.',$6,FALSE),
     ($3,'BOOKING_CONFIRMED','Booking #3 has been confirmed by Arjun Mehta.',$7,FALSE)`,
    [clientChris, proIds['maya@example.com'], clientDana, b1Id, b2Id, b4Id, b3Id]
  );

  // 9. Initial Audit Log
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES
     ($1,'PLATFORM_INIT','system',NULL,'System bootstrapped with demo users, portfolios, and escrow records'),
     ($1,'VERIFICATION_SUBMITTED','verification',1,'Vikram Sethi submitted identity verification documents')`,
    [adminId]
  );

  console.log('✅ Comprehensive demo data populated successfully!');
  console.log('--- DEMO ACCOUNTS FOR 5-6 MINUTE VIDEO ---');
  console.log('Client: client@example.com / Client@123 (Active bookings, deliverables to approve, receipts)');
  console.log('Client 2: client2@example.com / Client@123');
  console.log('Maya (Pro Photographer): maya@example.com / Pro@12345 (Pending requests to accept, portfolio, payout history)');
  console.log('Arjun (Pro Videographer): arjun@example.com / Pro@12345 (Upcoming confirmed shoots, video portfolio)');
  console.log('Admin: admin@example.com / Admin@123 (Revenue volume charts, verifications queue, dispute center)');
  console.log('Support: support@example.com / Support@123 (Dispute resolution & content moderation)');
}

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
