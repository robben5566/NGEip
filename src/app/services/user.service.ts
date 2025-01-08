import { Injectable, inject } from '@angular/core';
import {
  Auth,
  User as FirebaseUser,
  authState,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from '@angular/fire/auth';
import {
  FieldValue,
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  docData,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { from, map, Observable, shareReplay, switchMap } from 'rxjs';

import { License } from './system-config.service';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly auth = inject(Auth);
  private readonly authState$: Observable<FirebaseUser | null> = authState(
    this.auth
  );
  readonly currentUser$ = this.authState$.pipe(
    switchMap(
      (user) =>
        docData(doc(this.firestore, 'users', user!.uid), {
          idField: 'uid',
        }) as Observable<User>
    ),
    shareReplay(1)
  );
  readonly firestore: Firestore = inject(Firestore);
  readonly list$ = collectionData(collection(this.firestore, 'users'), {
    idField: 'uid',
  }).pipe(shareReplay(1));
  readonly isAdmin$ = this.currentUser$.pipe(
    map((user) => user.role == 'admin')
  );

  constructor() {}

  createUser(email: string, password: string, name: string) {
    return from(
      (async () => {
        // Check users has the duplicate email
        const emailQuery = query(
          collection(this.firestore, 'users'),
          where('email', '==', email)
        );

        const emailSnapshot = await getDocs(emailQuery);
        if (!emailSnapshot.empty) {
          throw new Error('Email already exists');
        }
      })()
    ).pipe(
      switchMap(() =>
        from(
          runTransaction(this.firestore, async (transaction) => {
            // Check license
            const systemConfigDoc = await transaction.get(
              doc(this.firestore, 'systemConfig', 'license')
            );
            const systemConfig = systemConfigDoc.data() as License;
            if (systemConfig.currentUsers >= systemConfig.maxUsers) {
              throw new Error(
                'The maximum number of users has been reached. Please contact your administrator.'
              );
            }
            // Create user
            let uid: string;
            try {
              const userCredential = await createUserWithEmailAndPassword(
                this.auth,
                email,
                password
              );
              uid = userCredential.user.uid;
            } catch (error: any) {
              throw new Error(error.message);
            }
            // Add a new document with a uid
            const user: User = {
              email,
              name,
              remainingLeaveHours: 0,
              remoteWorkEligibility: 'N/A',
              remoteWorkRecommender: [],
              role: 'user',
            };
            transaction.set(doc(this.firestore, 'users', uid), user);
            // Update license
            transaction.update(doc(this.firestore, 'systemConfig', 'license'), {
              currentUsers: systemConfig.currentUsers + 1,
              lastUpdated: serverTimestamp(),
            });
          })
        )
      )
    );
  }

  updateUser(user: User) {
    const docRef = doc(this.firestore, 'users', user.uid!);
    const data = {
      name: user.name,
      phone: user.phone,
      remoteWorkEligibility: user.remoteWorkEligibility,
      remoteWorkRecommender: user.remoteWorkRecommender,
      birthday: user.birthday,
    };
    return from(updateDoc(docRef, data));
  }

  updateUserAdvanced(user: User) { 
    const docRef = doc(this.firestore, 'users', user.uid!);
    const data = {
      jobRank: user.jobRank,
      jobTitle: user.jobTitle,
      role: user.role,
      startDate: user.startDate,
    };
    return from(updateDoc(docRef, data));
  }

  login(email: string, password: string) {
    return from(signInWithEmailAndPassword(this.auth, email, password));
  }

  logout() {
    return from(signOut(this.auth));
  }
}

export interface User {
  birthday?: Timestamp | FieldValue;
  email: string;
  jobRank?: string;
  jobTitle?: string;
  leaveTransactionHistory?: LeaveTransaction[]; // 休假交易紀錄
  name: string;
  phone?: string;
  photo?: string;
  remainingLeaveHours: number; // 剩餘特休時數
  remoteWorkEligibility: 'N/A' | 'WFH2' | 'WFH4.5'; // 遠距工作資格
  remoteWorkRecommender: string[];
  role: 'admin' | 'user';
  startDate?: Timestamp | FieldValue; // 到職日
  uid?: string;
}

interface LeaveTransaction {
  actionBy?: string;
  date: Timestamp | FieldValue;
  hours: number;
  reason?: string;
  type: 'add' | 'deduct';
}
