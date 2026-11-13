
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import Admin from "./Admin";

type DrinkKind = "classic" | "vanilla" | "berry";
type Size = "Small" | "Large";
type Page = "menu" | "cart";

type Product = {
  id: number;
  name: string;
  kind: DrinkKind;
  description: string;
  smallPrice: number;
  largePrice: number;
};

type CartItem = {
  productId: number;
  size: Size;
  quantity: number;
};

const formatPrice = (amount: number) => `₱${amount.toFixed(2)}`;

// Keep phone numbers as text so their leading zero is preserved.
const phoneDigits = (value: string) => value.replace(/\D/g, "").slice(0, 11);
const isValidPhone = (value: string) => /^09\d{9}$/.test(value);

const formatPhone = (value: string) => {
  const digits = phoneDigits(value);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
};


// Café moderation rules. Client-side only; the database should validate separately.
const profanityWarning = "Oopsie! That's a little too spicy for our matcha! 🍵🌶️";
const profanityHelp = "Please keep your name and order notes sweet and respectful. 💜";
const personalWarning = "Our matcha is available, but our staff's personal details aren't! 🤭🍵";
const personalHelp = "Please keep order notes about your drinks. Thank you for respecting our lovely team! 💜";

const normalizeMessage = (value: string) =>
  value.normalize("NFKC").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

// Match whole words/phrases after normalization to avoid blocking innocent names.
// Keep this list focused on explicit language and direct insults.
const profanityPatterns = [
  // Filipino and Tagalog
  /\b(?:putang\s*ina|putangina|tang\s*ina|tangina|pota|puta|pakshet|pakshit|gago|gaga|gagu|tanga|ulol|tarantado|tarantada|leche|letse|punyeta|punyemas|lintik)\b/,
  // Bisaya/Cebuano and other commonly used local expressions
  /\b(?:yawa|pisti|peste|buang|animal\s*ka|iyot|iyuta|kantot|kantutan|kantuta|kayata|kayat|bilat|burat|oten|otoy)\b/,
  // Explicit sexual terms and insults in English / Filipino
  /\b(?:sex|sexual|sexy\s*time|porn|porno|pornography|nudes?|naked|blow\s*job|blowjob|hand\s*job|handjob|masturbat(?:e|ion|ing)|titi|pekpek|puke|puki|libog|malibog|jakol|jabol)\b/,
  // English profanity, including common spaced forms
  /\b(?:fuck|fucks|fucked|fucking|fucker|fuckers|fuck\s*you|mother\s*fucker|mother\s*fuckers|mother\s*fucking|motherfucker|motherfuckers|motherfucking|shit|shitty|bull\s*shit|bullshit|bitch|bitches|asshole|assholes|dickhead|dickheads|dick|dicks|cock|cocks|cunt|cunts|wtf)\b/,
  // Custom café-specific blocked word
  /\besmirengoy\b/,
  /\bkepkeps?\b/,
];

// These are requests for staff contact/relationship details, not ordinary drink notes.
const personalRequestPatterns = [
  /\b(?:are\s+(?:you|u)\s+single|single\s+ka\s+ba|single\s+ka|may\s+(?:boyfriend|girlfriend|jowa|asawa)\s+ka)\b/,
  /\b(?:can\s+i\s+(?:get|have|ask\s+for)\s+(?:your|ur)\s+(?:phone\s+)?(?:number|num|contact|ig|instagram|facebook|fb)|what\s*(?:is|s)\s+(?:your|ur)\s+(?:number|ig|instagram|facebook|fb)|what\s+is\s+your\s+number)\b/,
  /\b(?:pwede|puwede|pwedi|pede)\s+(?:ba\s+)?(?:mak(?:uha|uha)|hingi|manghingi|pa\s*hingi)\s+(?:ng\s+)?(?:number|num|contact|ig|instagram|fb|facebook)(?:\s+mo)?\b/,
  /\b(?:ano\s+(?:number|ig|instagram|fb|facebook)\s+mo|bigay\s+mo\s+(?:number|ig|instagram|fb|facebook)\s+mo|unsa\s+(?:imong|imo)\s+(?:number|ig|facebook))\b/,
];

// Normalize common leetspeak only for profanity checks, never for customer data.
// Keep word boundaries so ordinary names aren't blocked by partial matches.
const normalizeProfanity = (value: string) =>
  value.normalize("NFKC").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[@4]/g, "a")
    .replace(/3/g, "e")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/\$/g, "s")
    .replace(/[^a-z0-9]+/g, " ").trim();

// Common censored spellings and missing-vowel forms, including spaced words.
const disguisedProfanityPatterns = [
  /\b(?:mother\s*f(?:u|\s+u)?c?k(?:e|a)?r|mother\s*fck(?:e|a)?r|moth[ea]r\s*fck(?:e|a)?r)\b/,
  /\b(?:f\s*u\s*c\s*k|fck|f\s*u\s*k|f\s*ck|fuk|fck\s*(?:you|u))\b/,
  /\b(?:sh\s*i\s*t|sht|b\s*i\s*t\s*c\s*h)\b/,
];

const containsProfanity = (value: string) => {
  const normalized = normalizeProfanity(value);
  return profanityPatterns.some((pattern) => pattern.test(normalized)) ||
    disguisedProfanityPatterns.some((pattern) => pattern.test(normalized));
};

// Allow real names with Unicode letters, spaces, apostrophes, and hyphens.
// Reject digits, emojis, and other symbols without silently changing the name.
const isValidCustomerName = (value: string) =>
  /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(value.trim());
// Format each name part on blur, including multiple given names.
const titleCaseName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase().replace(/(^|[ '\u2019-])([\p{L}])/gu,
    (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase());
const nameWarning = "Oopsie! Let's keep your name simple and sweet. 🌸";
const nameHelp = "Please use letters, spaces, hyphens, or apostrophes only. 💜";
const containsPersonalRequest = (value: string) => {
  const normalized = normalizeMessage(value);
  return personalRequestPatterns.some((pattern) => pattern.test(normalized));
};

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.5 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 8H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="19.5" r="1.3" fill="currentColor" />
      <circle cx="18" cy="19.5" r="1.3" fill="currentColor" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m15 18-6-6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5 12.5 4.2 4.2L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <path
          d="M9 16h26l-3 18c-1 6-18 6-20 0Z"
          fill="#fff"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinejoin="round"
        />
        <path
          d="M35 20h3c7 0 7 11 0 12h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
        />
        <ellipse
          cx="22"
          cy="16"
          rx="13"
          ry="4"
          fill="#c8a2e8"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M18 15c2-4 6-4 8 0"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function TeaCup() {
  return (
    <svg
      viewBox="0 0 260 220"
      className="hero-cup"
      role="img"
      aria-label="Illustrated matcha cup"
    >
      <defs>
        <linearGradient id="cup-body" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#eadbf6" />
        </linearGradient>
        <filter id="cup-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow
            dx="0"
            dy="12"
            stdDeviation="9"
            floodColor="#49345f"
            floodOpacity=".18"
          />
        </filter>
      </defs>
      <ellipse cx="127" cy="196" rx="86" ry="13" fill="#9b72cf" opacity=".15" />
      <g filter="url(#cup-shadow)">
        <path
          d="M52 66h132l-12 90c-3 24-100 24-106 0Z"
          fill="url(#cup-body)"
          stroke="#9B72CF"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path
          d="M184 86h14c37 0 37 55-2 57h-19"
          fill="none"
          stroke="#9B72CF"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <ellipse
          cx="118"
          cy="67"
          rx="66"
          ry="17"
          fill="#DDEACB"
          stroke="#9B72CF"
          strokeWidth="5"
        />
        <ellipse cx="118" cy="66" rx="56" ry="12" fill="#8FAE68" />
        <path
          d="M78 65c24-11 54 12 80-1"
          fill="none"
          stroke="#DCE9C8"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M75 96c3 28 7 46 16 62"
          fill="none"
          stroke="#fff"
          strokeWidth="7"
          strokeLinecap="round"
          opacity=".65"
        />
      </g>
      <path
        d="M88 42c-12-13 7-25 17-12 10-13 29-1 17 12l-17 15Z"
        fill="#F7DDF0"
        stroke="#9B72CF"
        strokeWidth="3"
      />
      <path
        d="M144 32c4-11 4-18 1-25M165 39c9-10 13-19 12-27"
        fill="none"
        stroke="#C8A2E8"
        strokeWidth="5"
        strokeLinecap="round"
        opacity=".8"
      />
    </svg>
  );
}

function Drink({ kind }: { kind: DrinkKind }) {
  const id = `drink-${kind}`;
  const isBerry = kind === "berry";
  const isVanilla = kind === "vanilla";

  return (
    <svg
      viewBox="0 0 190 240"
      className="drink-art"
      role="img"
      aria-label={`${kind} matcha drink`}
    >
      <defs>
        <linearGradient id={`${id}-green`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#BFD49C" />
          <stop offset="1" stopColor="#739A58" />
        </linearGradient>
        <linearGradient id={`${id}-berry`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#D99BC4" />
          <stop offset="1" stopColor="#8B4F83" />
        </linearGradient>
        <linearGradient id={`${id}-vanilla`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FFF2CF" />
          <stop offset="1" stopColor="#E4B35C" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff" stopOpacity=".7" />
          <stop offset=".48" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#D8C8DF" stopOpacity=".35" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d="M44 55h102l-12 153c-1 12-76 12-78 0Z" />
        </clipPath>
        <filter id={`${id}-shadow`} x="-30%" y="-20%" width="160%" height="150%">
          <feDropShadow
            dx="0"
            dy="7"
            stdDeviation="5"
            floodColor="#49345f"
            floodOpacity=".22"
          />
        </filter>
      </defs>

      <ellipse cx="95" cy="218" rx="58" ry="9" fill="#9B72CF" opacity=".16" />

      <g filter={`url(#${id}-shadow)`}>
        <g clipPath={`url(#${id}-clip)`}>
          <rect x="42" y="54" width="106" height="166" fill="#F6F1E9" />

          {isBerry ? (
            <>
              <rect x="42" y="145" width="106" height="77" fill={`url(#${id}-berry)`} />
              <path
                d="M42 118c24 1 27 18 50 15 22-3 29-16 56-7v33H42Z"
                fill="#F8E7F2"
              />
              <path
                d="M42 78h106v56c-21-4-31 13-56 8-20-4-28-15-50-10Z"
                fill={`url(#${id}-green)`}
              />
              {[0, 1, 2, 3, 4].map((n) => (
                <circle
                  key={n}
                  cx={59 + ((n * 18) % 70)}
                  cy={163 + (n % 2) * 19}
                  r={8}
                  fill={n % 2 ? "#6F3A6E" : "#A35C91"}
                />
              ))}
            </>
          ) : isVanilla ? (
            <>
              <rect x="42" y="151" width="106" height="70" fill={`url(#${id}-vanilla)`} />
              <path
                d="M42 124c24-8 34 13 55 7 19-6 31-17 51-5v36c-24-6-39 13-63 4-18-7-27-8-43-1Z"
                fill="#FFF9EB"
              />
              <path
                d="M42 77h106v58c-25-8-38 11-62 3-17-6-27-13-44-6Z"
                fill={`url(#${id}-green)`}
              />
              <path
                d="M49 176c25-20 36 18 61-1 14-11 23-9 34-5"
                fill="none"
                stroke="#D79736"
                strokeWidth="8"
                opacity=".8"
              />
            </>
          ) : (
            <>
              <rect x="42" y="128" width="106" height="94" fill="#60874C" />
              <path
                d="M42 98h106v55c-21 8-36-8-56 0-25 10-31-11-50-2Z"
                fill={`url(#${id}-green)`}
              />
              <path
                d="M42 77h106v39c-19 5-31-9-51-1-25 9-36-9-55 0Z"
                fill="#EDF0E0"
              />
            </>
          )}

          <g opacity=".45" fill="#fff" stroke="#D9D4D5" strokeWidth="1.2">
            <path d="m58 88 23-7 10 26-24 7Z" />
            <path d="m100 83 25 6-8 27-23-8Z" />
            <path d="m61 128 23 5-6 25-22-5Z" />
            <path d="m104 136 25-8 7 25-26 8Z" />
          </g>
        </g>

        <path
          d="M44 55h102l-12 153c-1 12-76 12-78 0Z"
          fill={`url(#${id}-glass)`}
          stroke="#A991AF"
          strokeWidth="3"
        />
        <ellipse
          cx="95"
          cy="56"
          rx="51"
          ry="14"
          fill="#EAF0DE"
          stroke="#A991AF"
          strokeWidth="3"
        />
        <ellipse cx="95" cy="55" rx="43" ry="9" fill="#98B777" />
        <path
          d="M59 55c22-10 50 10 74-1"
          fill="none"
          stroke="#DFEBCB"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>

      {isVanilla && (
        <>
          <path
            d="M88 38c9-15 31-10 32-1-7-4-17 0-15 6 12-3 23 5 17 14H64c-6-9 5-16 16-14-4-6 1-10 8-11"
            fill="#FFF9EE"
            stroke="#C9A777"
            strokeWidth="2.5"
          />
          <path
            d="M76 46c10-4 26-1 38 6"
            fill="none"
            stroke="#D99A35"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}

      {isBerry && (
        <>
          <circle cx="78" cy="47" r="11" fill="#675081" stroke="#fff" strokeWidth="2.5" />
          <circle cx="98" cy="44" r="12" fill="#BF628E" stroke="#fff" strokeWidth="2.5" />
          <circle cx="117" cy="48" r="10" fill="#513C6B" stroke="#fff" strokeWidth="2.5" />
          <path
            d="M98 31c3-8 8-11 15-13"
            fill="none"
            stroke="#6C9258"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (product: Product, size: Size) => void;
}) {
  const [size, setSize] = useState<Size>("Small");
  const price = size === "Small" ? product.smallPrice : product.largePrice;

  return (
    <article className={`product-card ${product.kind}`}>
      <div className="card-decoration" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="product-visual">
        <span className="flavor-label">
          {product.kind === "classic" ? "original" : product.kind}
        </span>
        <Drink kind={product.kind} />
      </div>

      <div className="product-copy">
        <div>
          <p className="eyebrow">HAMIMAZI SIGNATURE</p>
          <h3>{product.name}</h3>
        </div>
        <p>{product.description}</p>
      </div>

      <div className="size-row" aria-label={`Choose a size for ${product.name}`}>
        {(["Small", "Large"] as const).map((option) => {
          const optionPrice =
            option === "Small" ? product.smallPrice : product.largePrice;

          return (
            <button
              key={option}
              type="button"
              className={size === option ? "size-option selected" : "size-option"}
              onClick={() => setSize(option)}
              aria-pressed={size === option}
            >
              <span>{option}</span>
              <strong>{formatPrice(optionPrice)}</strong>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="add-button"
        onClick={() => onAdd(product, size)}
      >
        <CartIcon />
        Add to Cart
        <span>{formatPrice(price)}</span>
      </button>
    </article>
  );
}

function Navigation({
  page,
  cartCount,
  onNavigate,
}: {
  page: Page;
  cartCount: number;
  onNavigate: (page: Page) => void;
}) {
  return (
    <header className="site-header">
      <div className="nav-inner">
        <button
          type="button"
          className="logo"
          onClick={() => onNavigate("menu")}
          aria-label="Hamimazi Cafe home"
        >
          <BrandMark />
          <span>
            <strong>HAMIMAZI</strong>
            <small>CAFE</small>
          </span>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          <button
            type="button"
            className={page === "menu" ? "active" : ""}
            onClick={() => onNavigate("menu")}
          >
            Menu
          </button>

          <button
            type="button"
            className={page === "cart" ? "active cart-nav" : "cart-nav"}
            onClick={() => onNavigate("cart")}
          >
            <CartIcon />
            <span>Shopping Cart</span>
            <b aria-label={`${cartCount} items in cart`}>{cartCount}</b>
          </button>
        </nav>
      </div>
    </header>
  );
}

function Decorations() {
  return (
    <div className="decorations" aria-hidden="true">
      <span className="d-heart">
        <HeartIcon filled />
      </span>
      <span className="d-star one">✦</span>
      <span className="d-star two">✦</span>
      <span className="d-flower one">✿</span>
      <span className="d-flower two">✿</span>
      <span className="d-bow">
        <i />
        <b />
        <em />
      </span>
    </div>
  );
}

export default function App() {
  if (window.location.pathname.replace(/\/$/, "") === "/admin") return <Admin />;
  const [page, setPage] = useState<Page>("menu");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toast, setToast] = useState("");

  const [confirmation, setConfirmation] = useState<{
    total: number;
    items: number;
    customerName: string;
  } | null>(null);

  // Customer checkout information
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const customerName = `${titleCaseName(firstName)} ${titleCaseName(lastName)}`.trim();
  const [contactNumber, setContactNumber] = useState("");
  const [orderNotes, setOrderNotes] = useState("");

  // Checkout status and errors
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [moderationPopup, setModerationPopup] = useState<"profanity" | "personal" | null>(null);

  // Supabase product state
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState("");

  // Load products from Supabase
  useEffect(() => {
    let isActive = true;

    const loadProducts = async () => {
      setLoadingProducts(true);
      setProductError("");

      const { data, error } = await supabase
        .from("products")
        .select("id, name, description, small_price, large_price")
        .eq("is_available", true)
        .order("id");

      if (!isActive) return;

      if (error) {
        console.error("Supabase product loading error:", error);
        setProductError(error.message);
        setLoadingProducts(false);
        return;
      }

      const formattedProducts: Product[] = (data ?? []).map((item) => ({
        id: Number(item.id),
        name: item.name,
        kind: item.name.toLowerCase().includes("vanilla")
          ? "vanilla"
          : item.name.toLowerCase().includes("berry")
            ? "berry"
            : "classic",
        description: item.description ?? "",
        smallPrice: Number(item.small_price),
        largePrice: Number(item.large_price),
      }));

      setProducts(formattedProducts);
      setLoadingProducts(false);
    };

    loadProducts();

    return () => {
      isActive = false;
    };
  }, []);

  // Toast notification
  useEffect(() => {
    if (!toast) return;

    const timeout = window.setTimeout(() => setToast(""), 2200);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  const addToCart = (product: Product, size: Size) => {
    setCart((current) => {
      const existing = current.find(
        (item) => item.productId === product.id && item.size === size
      );

      if (existing) {
        return current.map((item) =>
          item.productId === product.id && item.size === size
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...current, { productId: product.id, size, quantity: 1 }];
    });

    setOrderError("");
    setToast(`${product.name} added to your cart`);
  };

  const getPrice = (product: Product, size: Size) =>
    size === "Small" ? product.smallPrice : product.largePrice;

  const cartDetails = cart.flatMap((item) => {
    const product = products.find(
      (candidate) => candidate.id === item.productId
    );

    if (!product) return [];

    const price = getPrice(product, item.size);

    return [
      {
        ...item,
        product,
        price,
        subtotal: price * item.quantity,
      },
    ];
  });

  const cartCount = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const total = cartDetails.reduce(
    (sum, item) => sum + item.subtotal,
    0
  );

  const changeQuantity = (
    productId: number,
    size: Size,
    amount: number
  ) => {
    setCart((current) =>
      current
        .map((item) =>
          item.productId === productId && item.size === size
            ? { ...item, quantity: item.quantity + amount }
            : item
        )
        .filter((item) => item.quantity > 0)
    );

    setOrderError("");
  };

  const changeSize = (
    productId: number,
    oldSize: Size,
    newSize: Size
  ) => {
    if (oldSize === newSize) return;

    setCart((current) => {
      const changing = current.find(
        (item) => item.productId === productId && item.size === oldSize
      );

      if (!changing) return current;

      const existing = current.find(
        (item) => item.productId === productId && item.size === newSize
      );

      if (existing) {
        return current
          .filter(
            (item) =>
              !(
                item.productId === productId &&
                (item.size === oldSize || item.size === newSize)
              )
          )
          .concat({
            ...existing,
            quantity: existing.quantity + changing.quantity,
          });
      }

      return current.map((item) =>
        item.productId === productId && item.size === oldSize
          ? { ...item, size: newSize }
          : item
      );
    });

    setOrderError("");
  };

  const removeItem = (productId: number, size: Size) => {
    setCart((current) =>
      current.filter(
        (item) =>
          !(item.productId === productId && item.size === size)
      )
    );

    setOrderError("");
  };

  // Save the complete order through the Supabase database function.
  const checkout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) return;

    if (!firstName.trim() || !lastName.trim()) {
      setOrderError("Just one more little detail! 🌸 Please add your first and last name. 💜");
      return;
    }

    if (!isValidCustomerName(firstName) || !isValidCustomerName(lastName)) {
      setOrderError(`${nameWarning} ${nameHelp}`);
      return;
    }

    if (containsProfanity(customerName) || containsProfanity(orderNotes)) {
      setOrderError("");
      setModerationPopup("profanity");
      return;
    }

    if (containsPersonalRequest(orderNotes)) {
      setOrderError("");
      setModerationPopup("personal");
      return;
    }

    if (contactNumber && !isValidPhone(contactNumber)) {
      setOrderError("Please enter a valid 11-digit mobile number starting with 09.");
      return;
    }

    if (cartCount === 0 || cartDetails.length === 0) {
      setOrderError("Your cart is empty. Please add a drink first.");
      return;
    }

    setIsSubmitting(true);
    setOrderError("");

    try {
      const orderItems = cartDetails.map((item) => ({
        product_id: item.productId,
        size: item.size,
        quantity: item.quantity,
      }));

      const { data: orderId, error } = await supabase.rpc("place_order", {
        p_customer_name: customerName.trim(),
        p_contact_number: contactNumber.trim() || null,
        p_notes: orderNotes.trim() || null,
        p_items: orderItems,
      });

      if (error) {
        console.error("Supabase checkout error:", error);
        throw new Error(error.message);
      }

      if (!orderId) {
        throw new Error("The order was not confirmed by the database.");
      }

      // Only clear the cart after Supabase confirms the order.
      setConfirmation({
        total,
        items: cartCount,
        customerName,
      });

      setCart([]);
      setFirstName("");
      setLastName("");
      setContactNumber("");
      setOrderNotes("");
      setOrderError("");

      console.log("Order successfully saved:", orderId);
    } catch (error) {
      console.error("Checkout failed:", error);

      setOrderError(
        error instanceof Error
          ? error.message
          : "Something went wrong while placing your order. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell">
      <Navigation
        page={page}
        cartCount={cartCount}
        onNavigate={setPage}
      />

      {page === "menu" ? (
        <main>
          <section className="hero">
            <Decorations />

            <div className="hero-inner">
              <div className="hero-copy">
                <p className="kicker">
                  <span /> MATCHA, MADE WITH LOVE <span />
                </p>

                <h1>
                  A little cup of <em>happiness</em>
                </h1>

                <p>
                  Slow down, sip softly, and discover your new favorite
                  matcha moment at Hamimazi Cafe.
                </p>

                <a href="#menu">
                  Explore our menu <span>↓</span>
                </a>
              </div>

              <div className="hero-art">
                <div className="hero-blob" />
                <TeaCup />
                <span className="hero-note">
                  hand-whisked
                  <br />
                  just for you
                </span>
              </div>
            </div>

            <div className="hero-wave" />
          </section>

          <section className="menu-section" id="menu">
            <div className="section-heading">
              <p>OUR SWEET SELECTION</p>
              <h2>Find your perfect matcha</h2>
              <span>
                Three dreamy sips, each mixed fresh to order.
              </span>
            </div>

            <div className="product-grid">
              {loadingProducts ? (
                <p>Preparing your lovely matcha menu...</p>
              ) : productError ? (
                <p role="alert">
                  Unable to load menu: {productError}
                </p>
              ) : products.length === 0 ? (
                <p>No drinks are currently available.</p>
              ) : (
                products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAdd={addToCart}
                  />
                ))
              )}
            </div>
          </section>

          <section className="love-note">
            <div className="love-icon">
              <HeartIcon />
            </div>
            <p>Whisked fresh. Poured with care.</p>
            <span>
              Your cozy matcha moment is only a cup away.
            </span>
          </section>
        </main>
      ) : (
        <main className="cart-page">
          <div className="cart-heading">
            <button
              type="button"
              className="back-button"
              onClick={() => setPage("menu")}
            >
              <ArrowIcon /> Back to Menu
            </button>

            <p>YOUR LOVELY ORDER</p>
            <h1>Shopping Cart</h1>

            <span>
              {cartCount === 0
                ? "Ready for something sweet?"
                : `${cartCount} ${cartCount === 1 ? "item" : "items"} waiting for you`}
            </span>
          </div>

          {cartDetails.length === 0 ? (
            <section className="empty-cart">
              <div className="empty-cart-illustration">
                <BrandMark />
                <span>
                  <HeartIcon />
                </span>
              </div>

              <h2>Your cart is feeling a little lonely</h2>
              <p>
                Add a dreamy matcha drink and make its day.
              </p>

              <button
                type="button"
                className="primary-button"
                onClick={() => setPage("menu")}
              >
                Explore the Menu
              </button>
            </section>
          ) : (
            <div className="cart-layout">
              <section className="cart-list" aria-label="Cart items">
                {cartDetails.map((item) => (
                  <article
                    className="cart-item"
                    key={`${item.productId}-${item.size}`}
                  >
                    <div
                      className={`cart-product-image ${item.product.kind}`}
                    >
                      <Drink kind={item.product.kind} />
                    </div>

                    <div className="cart-product-info">
                      <p>HAMIMAZI SIGNATURE</p>
                      <h2>{item.product.name}</h2>

                      <label>
                        <span>Size</span>
                        <select
                          value={item.size}
                          onChange={(event) =>
                            changeSize(
                              item.productId,
                              item.size,
                              event.target.value as Size
                            )
                          }
                        >
                          <option value="Small">
                            Small · {formatPrice(item.product.smallPrice)}
                          </option>
                          <option value="Large">
                            Large · {formatPrice(item.product.largePrice)}
                          </option>
                        </select>
                      </label>

                      <button
                        type="button"
                        className="remove-button"
                        onClick={() =>
                          removeItem(item.productId, item.size)
                        }
                      >
                        <TrashIcon /> Remove
                      </button>
                    </div>

                    <div className="cart-item-actions">
                      <div
                        className="quantity-control"
                        aria-label={`Quantity for ${item.product.name}`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            changeQuantity(
                              item.productId,
                              item.size,
                              -1
                            )
                          }
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>

                        <span>{item.quantity}</span>

                        <button
                          type="button"
                          onClick={() =>
                            changeQuantity(
                              item.productId,
                              item.size,
                              1
                            )
                          }
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>

                      <strong>{formatPrice(item.subtotal)}</strong>
                    </div>
                  </article>
                ))}
              </section>

              <aside className="cart-summary">
                <div className="summary-title">
                  <span><HeartIcon /></span>
                  <div>
                    <p className="summary-eyebrow">YOUR SWEET LITTLE ORDER</p>
                    <h2>Order Summary</h2>
                  </div>
                </div>

                <div className="summary-breakdown">
                  <div className="summary-line">
                    <span>Subtotal ({cartCount} {cartCount === 1 ? "item" : "items"})</span>
                    <strong>{formatPrice(total)}</strong>
                  </div>
                  <div className="summary-line">
                    <span>Service fee</span>
                    <strong className="summary-free">Free</strong>
                  </div>
                </div>

                <div className="summary-total">
                  <div>
                    <span>Total amount</span>
                    <small>Made fresh, just for you ♡</small>
                  </div>
                  <strong>{formatPrice(total)}</strong>
                </div>

                <form className="checkout-form" onSubmit={checkout}>
                  <div className="checkout-heading">
                    <span className="checkout-heading-icon" aria-hidden="true">♡</span>
                    <div>
                      <h3>Customer Details</h3>
                      <p>A few little details before we whisk your matcha.</p>
                    </div>
                  </div>

                  <label className="checkout-field">
                    <span>First name <b className="required-mark">*</b></span>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(event) => { setFirstName(event.target.value); setOrderError(""); }}
                      onBlur={() => setFirstName((value) => titleCaseName(value))}
                      placeholder="Maria Princess Emily"
                      autoComplete="given-name"
                      maxLength={100}
                      required
                      disabled={isSubmitting}
                    />
                    {firstName.trim() && !isValidCustomerName(firstName) && (
                      <small className="field-error" role="alert"><strong>{nameWarning}</strong> {nameHelp}</small>
                    )}
                    {containsProfanity(firstName) && (
                      <small className="field-error" role="alert"><strong>{profanityWarning}</strong> {profanityHelp}</small>
                    )}
                  </label>

                  <label className="checkout-field">
                    <span>Last name <b className="required-mark">*</b></span>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(event) => { setLastName(event.target.value); setOrderError(""); }}
                      onBlur={() => setLastName((value) => titleCaseName(value))}
                      placeholder="Mayton"
                      autoComplete="family-name"
                      maxLength={100}
                      required
                      disabled={isSubmitting}
                    />
                    {lastName.trim() && !isValidCustomerName(lastName) && (
                      <small className="field-error" role="alert"><strong>{nameWarning}</strong> {nameHelp}</small>
                    )}
                    {containsProfanity(lastName) && (
                      <small className="field-error" role="alert"><strong>{profanityWarning}</strong> {profanityHelp}</small>
                    )}
                  </label>

                  <label className="checkout-field">
                    <span>Contact number <em className="optional-mark">Optional</em></span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      value={formatPhone(contactNumber)}
                      onChange={(event) => {
                        const digits = phoneDigits(event.target.value);
                        // Accept empty input, or a number being typed starting 0 then 09.
                        if (digits && !"09".startsWith(digits.slice(0, 2))) return;
                        setContactNumber(digits);
                        setOrderError("");
                      }}
                      placeholder="0916-735-1231"
                      maxLength={13}
                      aria-invalid={contactNumber.length > 0 && !isValidPhone(contactNumber)}
                      aria-describedby="phone-hint"
                      disabled={isSubmitting}
                    />
                    <small id="phone-hint" className="field-hint">
                      11 digits starting with 09. Numbers only.
                    </small>
                    {contactNumber.length > 0 && !isValidPhone(contactNumber) && (
                      <small className="field-error">
                        Please complete your 11-digit mobile number.
                      </small>
                    )}
                  </label>

                  <label className="checkout-field">
                    <span>Order notes <em className="optional-mark">Optional</em></span>
                    <textarea
                      value={orderNotes}
                      onChange={(event) => {
                        setOrderNotes(event.target.value);
                        setOrderError("");
                      }}
                      placeholder="Less ice? Extra sweetness? Tell us here..."
                      rows={3}
                      maxLength={500}
                      disabled={isSubmitting}
                    />
                    <small className="field-hint">Special requests are welcome ♡</small>
                    {containsProfanity(orderNotes) ? (
                      <small className="field-error" role="alert">
                        <strong>{profanityWarning}</strong> {profanityHelp}
                      </small>
                    ) : containsPersonalRequest(orderNotes) ? (
                      <small className="field-error" role="alert">
                        <strong>{personalWarning}</strong> {personalHelp}
                      </small>
                    ) : null}
                  </label>

                  {orderError && (
                    <p className="checkout-error" role="alert">{orderError}</p>
                  )}

                  <button
                    type="submit"
                    className="checkout-button"
                    disabled={isSubmitting || loadingProducts}
                  >
                    {isSubmitting ? "Saving your order..." : <>Place My Order <span>→</span></>}
                  </button>
                </form>

                <button
                  type="button"
                  className="clear-button"
                  onClick={() => {
                    setCart([]);
                    setOrderError("");
                  }}
                  disabled={isSubmitting}
                >
                  Clear shopping cart
                </button>

                <p className="checkout-reassurance">
                  <CheckIcon /> Made with love · Freshly prepared
                </p>
              </aside>
            </div>
          )}
        </main>
      )}

      <footer>
        <div className="footer-brand">
          <BrandMark />
          <span>
            <strong>HAMIMAZI CAFE</strong>
            <small>little sips, lovely moments</small>
          </span>
        </div>

        <a className="footer-staff-login" href="/admin" aria-label="Staff Login">
          <span className="footer-staff-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="7.5" r="3" />
              <path d="M3.5 18c0-3.2 2.4-5.2 5.5-5.2 1.2 0 2.3.3 3.2 1" />
              <rect x="13" y="14" width="8" height="7" rx="1.5" />
              <path d="M15 14v-2a2 2 0 0 1 4 0v2" />
            </svg>
          </span>
          <span>Staff Login</span>
        </a>
        <p>Made with love and a sprinkle of matcha.</p>
      </footer>

      {toast && (
        <div className="toast" role="status">
          <CheckIcon /> {toast}
        </div>
      )}

      {moderationPopup && (
        <div className="modal-backdrop">
          <section
            className="confirmation-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="moderation-popup-title"
            aria-describedby="moderation-popup-description"
          >
            <div className="confirmation-icon" aria-hidden="true">
              <HeartIcon />
            </div>
            <h2 id="moderation-popup-title" style={{ fontSize: "1.45rem", lineHeight: 1.35 }}>
              {moderationPopup === "profanity" ? profanityWarning : personalWarning}
            </h2>
            <p id="moderation-popup-description" style={{ margin: "1rem 0 1.5rem", lineHeight: 1.6 }}>
              {moderationPopup === "profanity" ? profanityHelp : personalHelp}
            </p>
            <button
              type="button"
              className="primary-button"
              autoFocus
              onClick={() => setModerationPopup(null)}
            >
              Okay, I'll keep it sweet! 💜
            </button>
          </section>
        </div>
      )}

      {confirmation && (
        <div className="modal-backdrop">
          <section
            className="confirmation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
          >
            <div className="confirmation-icon">
              <CheckIcon />
            </div>

            <p>ORDER RECEIVED</p>
            <h2 id="confirmation-title">Thank you, {confirmation.customerName.trim().split(/\s+/)[0]}! 💜</h2>
            <span>
              We have received your order! Payment has not been confirmed yet.
            </span>

            <div className="confirmation-details">
              <div>
                <span>Items</span>
                <strong>{confirmation.items}</strong>
              </div>

              <div>
                <span>Total</span>
                <strong>{formatPrice(confirmation.total)}</strong>
              </div>
            </div>

            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setConfirmation(null);
                setPage("menu");
              }}
            >
              Continue Shopping
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
