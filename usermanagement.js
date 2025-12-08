// usermanagement.js
import { db } from "./auth.js";

import {
    collection,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";